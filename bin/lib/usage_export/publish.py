import gzip
import json

from .schema import DAY_ENTRY, MANIFEST, TOKENS, VERSION, encode, validate
from .storage import private_directory, read_json, write_durably

MANIFEST_FILE = "manifest.json"
MAX_REPORT_DAYS = 3660
MAX_DAY_ENTRY_BYTES = 4096
MAX_MANIFEST_BYTES = (MAX_REPORT_DAYS + 1) * MAX_DAY_ENTRY_BYTES


def empty_total():
    return {"events": 0, "unpriced_events": 0, "missing_token_events": 0,
            "missing_duration_events": 0, "estimate_usd": None, "request_ms_sum": None,
            "tokens": dict.fromkeys(TOKENS["properties"])}


def add_total(total, event):
    total["events"] += 1
    estimate = event["cost"]["estimate_usd"]
    total["unpriced_events"] += int(estimate is None)
    total["missing_token_events"] += int(None in event["tokens"].values())
    total["missing_duration_events"] += int(event["duration_ms"] is None)
    if estimate is not None:
        total["estimate_usd"] = (total["estimate_usd"] or 0) + estimate
    if event["duration_ms"] is not None:
        total["request_ms_sum"] = (total["request_ms_sum"] or 0) + event["duration_ms"]
    for kind, amount in event["tokens"].items():
        if amount is not None:
            total["tokens"][kind] = (total["tokens"][kind] or 0) + amount


def conflicts(database, day):
    result = database.execute("""
        SELECT COUNT(*) FROM events current WHERE day=? AND (
            (response IS NOT NULL AND EXISTS (SELECT 1 FROM events other
                WHERE other.response=current.response AND other.id!=current.id)) OR
            (request IS NOT NULL AND EXISTS (SELECT 1 FROM events other
                WHERE other.request=current.request AND other.id!=current.id)))
    """, (day,)).fetchone()
    return result[0]


def write_day(database, directory, day):
    totals = {"workload": empty_total(), "routing-overhead": empty_total()}
    late = 0

    def write(stream):
        nonlocal late
        with gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as compressed:
            for encoded, is_late in database.execute(
                    "SELECT event, late FROM events WHERE day=? ORDER BY stamp, id", (day,)):
                event = json.loads(encoded)
                compressed.write((encoded + "\n").encode())
                add_total(totals[event["kind"]], event)
                late += is_late

    path, digest = write_durably(directory, write, lambda digest: f"{day}-{digest}.jsonl.gz")
    entry = {"day": day, "coverage": "partial", "file": f"days/{path.name}",
             "sha256": digest, "bytes": path.stat().st_size,
             "workload": totals["workload"], "overhead": totals["routing-overhead"],
             "late_events": late, "conflicting_id_events": conflicts(database, day)}
    validate(entry, DAY_ENTRY)
    return entry


def missing_day(day):
    return {"day": day, "coverage": "missing", "file": None, "sha256": None, "bytes": None,
            "workload": None, "overhead": None, "late_events": 0, "conflicting_id_events": 0}


def day_entry(database, day):
    saved = database.execute("SELECT entry FROM published WHERE day=?", (day,)).fetchone()
    return json.loads(saved[0]) if saved else missing_day(day)


def publish(database, identity, run, scan):
    private_directory(run.output)
    directory = run.output / "days"
    private_directory(directory)
    for (day,) in database.execute("SELECT day FROM dirty ORDER BY day"):
        entry = write_day(database, directory, day)
        database.execute("INSERT OR REPLACE INTO published VALUES (?, ?)", (day, encode(entry)))
    database.execute("DELETE FROM dirty")
    first, last = database.execute("SELECT MIN(stamp), MAX(stamp) FROM events").fetchone()
    manifest = {"schema_version": VERSION, "host_uuid": identity["host_uuid"],
                "source_ref": identity["source_ref"], "source": "magpie-ledger",
                "report_timezone": run.timezone, "last_scan_at": scan.last_scan_at,
                "first_event_at": first, "last_event_at": last,
                "source_retention": "unknown", "history": "partial",
                "identity_semantics": "host-source-fingerprint-partial-ids",
                "attribution": "ledger-only", "direct_usage": "not-collected",
                "scan": scan.summary, "days": [day_entry(database, day) for day in run.days]}
    validate(manifest, MANIFEST)
    contents = (encode(manifest) + "\n").encode()
    write_durably(run.output, lambda stream: stream.write(contents), lambda digest: MANIFEST_FILE)
    return manifest


def read_manifest(output):
    manifest = read_json(output / MANIFEST_FILE, MAX_MANIFEST_BYTES)
    validate(manifest, MANIFEST)
    return manifest
