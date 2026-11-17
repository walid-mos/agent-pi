import csv
import hashlib
import json
import math
import re

from .normalize import MAX_NUMBER, TOKEN_FIELDS, numeric, opaque, text, timestamp, unknown_cost
from .schema import encode
from .storage import MAX_LINE_BYTES

CSV_FIELDS = {"t": "time", "req": "requested_model", "provider": "provider", "served": "served_model",
              "in": "input_tokens", "out": "output_tokens", "cache_read": "cache_read_tokens",
              "cache_write": "cache_write_tokens", "cache_write_1h": "cache_write_1h_tokens",
              "reasoning": "reasoning_tokens", "ms": "duration_ms", "status": "status",
              "response_id": "response_id", "rid": "request_id", "kind": "kind"}
NUMERIC_FIELDS = (*TOKEN_FIELDS.values(), "ms", "status")
SIBLINGS = "(SELECT COUNT(*) FROM events sibling WHERE sibling.estimate_key=e.estimate_key)"
PRICED = "json_extract(e.event, '$.cost.estimate_usd') IS NOT NULL"


OFFSETLESS = re.compile(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?", re.ASCII)


def csv_instant(value):
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    try:
        return timestamp(candidate)
    except ValueError:
        pass
    if not OFFSETLESS.fullmatch(candidate):
        return None
    try:
        return timestamp(candidate.replace(" ", "T") + "Z")
    except ValueError:
        return None


def estimate_key(row, host):
    stamp = csv_instant(row.get("t"))
    if stamp is None:
        return None
    fixed = {field: text(row.get(field)) for field in CSV_FIELDS if field not in NUMERIC_FIELDS}
    fixed["t"] = stamp[:19] + "Z"
    for field in NUMERIC_FIELDS:
        value = numeric(row.get(field))
        fixed[field] = float(value) if value is not None else None
    return opaque(host["salt"], "estimate", fixed)


def csv_row(raw):
    result = {field: raw.get(column) for field, column in CSV_FIELDS.items()}
    for field in NUMERIC_FIELDS:
        value = result[field]
        result[field] = float(value) if value not in (None, "") else None
    return result


def bounded_lines(stream, digest):
    while line := stream.readline(MAX_LINE_BYTES + 1):
        if len(line) > MAX_LINE_BYTES:
            raise ValueError("oversize CSV row")
        digest.update(line)
        yield line.decode("utf-8-sig")


def load_estimates(database, host, run):
    database.execute("DELETE FROM estimates")
    digest = hashlib.sha256()
    with run.estimates.open("rb") as stream:
        reader = csv.DictReader(bounded_lines(stream, digest))
        if not set(CSV_FIELDS.values()).union({"cost_usd"}) <= set(reader.fieldnames or []):
            raise ValueError("unsupported CSV header")
        for raw in reader:
            insert_estimate(database, host, raw)
    return {"price_source": "magpie-csv-snapshot", "price_snapshot_at": run.price_snapshot_at,
            "snapshot_sha256": digest.hexdigest()}


def insert_estimate(database, host, raw):
    if raw["cost_usd"] in (None, ""):
        return
    try:
        amount = float(raw["cost_usd"])
    except ValueError:
        return
    if not math.isfinite(amount) or not 0 <= amount <= MAX_NUMBER:
        return
    key = estimate_key(csv_row(raw), host)
    if key is None:
        return
    database.execute("""INSERT INTO estimates VALUES (?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET matches=matches+1""", (key, amount))


def set_cost(database, identifier, day, event, cost):
    event["cost"] = cost
    database.execute("UPDATE events SET event=? WHERE id=?", (encode(event), identifier))
    database.execute("INSERT OR IGNORE INTO dirty VALUES (?)", (day,))


def revoke(database, query):
    for identifier, day, encoded in database.execute(query).fetchall():
        set_cost(database, identifier, day, json.loads(encoded), unknown_cost())


def revoke_ambiguous(database):
    revoke(database, f"""SELECT e.id, e.day, e.event FROM events e WHERE {PRICED} AND e.estimate_key IN (
        SELECT DISTINCT e.estimate_key FROM events e JOIN dirty d ON e.day=d.day WHERE {SIBLINGS}>1)""")


def revoke_snapshot_ambiguity(database):
    revoke(database, f"""SELECT e.id, e.day, e.event FROM events e JOIN estimates p
        ON e.estimate_key=p.key WHERE p.matches>1 AND {PRICED}""")


def apply_estimates(database, host, run):
    revoke_ambiguous(database)
    if run.estimates is None:
        return
    provenance = load_estimates(database, host, run)
    revoke_snapshot_ambiguity(database)
    candidates = database.execute(f"""SELECT e.id, e.day, e.event, p.amount FROM events e
        JOIN estimates p ON e.estimate_key=p.key WHERE p.matches=1 AND {SIBLINGS}=1
        AND NOT {PRICED}""").fetchall()
    for identifier, day, encoded, amount in candidates:
        event = json.loads(encoded)
        set_cost(database, identifier, day, event, {**event["cost"], **provenance, "estimate_usd": amount})
