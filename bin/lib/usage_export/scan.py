import hashlib
import json
import os
from datetime import timedelta

from .normalize import instant, normalize
from .schema import EVENT, encode, validate

MAX_LINE_BYTES = 1024 * 1024
ANCHOR_BYTES = 4096


def load_checkpoint(database):
    saved = database.execute("SELECT value FROM metadata WHERE key='checkpoint'").fetchone()
    return json.loads(saved[0]) if saved else None


def anchor(stream, offset):
    stream.seek(max(0, offset - ANCHOR_BYTES))
    return hashlib.sha256(stream.read(min(offset, ANCHOR_BYTES))).hexdigest()


def resume_offset(stream, snapshot, checkpoint, options):
    if not checkpoint or options.rescan:
        return 0
    is_same_file = checkpoint["device"] == snapshot.st_dev and checkpoint["inode"] == snapshot.st_ino
    if not is_same_file or snapshot.st_size < checkpoint["offset"]:
        return 0
    if anchor(stream, checkpoint["offset"]) != checkpoint["anchor"]:
        return 0
    return checkpoint["offset"]


def record_event(row, identity, database, options, catalog):
    event = normalize(row, identity, database, options.zone, catalog)
    if event is None:
        return "ignored_rows"
    identifier = event["event_id"]
    if database.execute("INSERT OR IGNORE INTO seen VALUES (?)", (identifier,)).rowcount == 0:
        return "duplicate_rows"
    validate(event, EVENT)
    day = event["ts_utc"][:10]
    is_late = instant(options.now).date() > instant(event["ts_utc"]).date() + timedelta(days=1)
    inserted = database.execute("INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (identifier, day, event["ts_utc"], event["kind"], event["response_ref"], event["request_ref"],
         options.estimate_key(row), int(is_late), encode(event))).rowcount
    if inserted:
        database.execute("INSERT OR IGNORE INTO dirty VALUES (?)", (day,))
        database.execute("""INSERT OR IGNORE INTO dirty
            SELECT day FROM events WHERE response=? OR request=?""",
            (event["response_ref"], event["request_ref"]))
    return None


def consume_line(line, identity, database, options, catalog):
    if len(line) > MAX_LINE_BYTES:
        return "invalid_rows"
    try:
        row = json.loads(line)
        return record_event(row, identity, database, options, catalog)
    except (ValueError, TypeError, RecursionError, OverflowError):
        return "invalid_rows"


def read_bounded_line(stream, snapshot_size):
    first = stream.readline(min(MAX_LINE_BYTES + 1, snapshot_size - stream.tell()))
    last = first
    while not last.endswith(b"\n") and stream.tell() < snapshot_size:
        last = stream.readline(min(MAX_LINE_BYTES, snapshot_size - stream.tell()))
    return first, last.endswith(b"\n")


def consume(stream, snapshot_size, identity, database, options, catalog, counters):
    while stream.tell() < snapshot_size:
        start = stream.tell()
        line, is_complete = read_bounded_line(stream, snapshot_size)
        if not is_complete:
            stream.seek(start)
            return
        outcome = consume_line(line, identity, database, options, catalog)
        if outcome:
            counters[outcome] += 1


def scan_ledger(database, identity, options, catalog):
    checkpoint = load_checkpoint(database)
    with options.ledger.open("rb") as stream:
        snapshot = os.fstat(stream.fileno())
        offset = resume_offset(stream, snapshot, checkpoint, options)
        counters = {key: 0 for key in ("invalid_rows", "ignored_rows", "duplicate_rows")}
        if offset and checkpoint:
            counters.update(checkpoint["counters"])
        else:
            database.execute("DELETE FROM seen")
        stream.seek(offset)
        consume(stream, snapshot.st_size, identity, database, options, catalog, counters)
        end = stream.tell()
        options.read_bytes = snapshot.st_size - offset
        saved = {"device": snapshot.st_dev, "inode": snapshot.st_ino, "offset": end,
                 "anchor": anchor(stream, end), "counters": counters,
                 "last_scan_at": options.now}
        if checkpoint and end == offset and end == checkpoint["offset"]:
            saved["last_scan_at"] = checkpoint["last_scan_at"]
        database.execute("INSERT OR REPLACE INTO metadata VALUES ('checkpoint', ?)", (encode(saved),))
    return {"ledger_bytes": end, **counters, "deferred_tail_bytes": snapshot.st_size - end}
