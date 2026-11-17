import csv
import json
import math

from .normalize import MAX_NUMBER, TOKEN_FIELDS, numeric, opaque, text, timestamp, unknown_cost
from .schema import encode
from .storage import MAX_LINE_BYTES, file_digest

CSV_FIELDS = {"t": "time", "req": "requested_model", "provider": "provider", "served": "served_model",
              "in": "input_tokens", "out": "output_tokens", "cache_read": "cache_read_tokens",
              "cache_write": "cache_write_tokens", "cache_write_1h": "cache_write_1h_tokens",
              "reasoning": "reasoning_tokens", "ms": "duration_ms", "status": "status",
              "response_id": "response_id", "rid": "request_id", "kind": "kind"}
NUMERIC_FIELDS = (*TOKEN_FIELDS.values(), "ms", "status")


def estimate_key(row, host):
    fixed = {field: text(row.get(field)) for field in CSV_FIELDS if field not in NUMERIC_FIELDS}
    fixed["t"] = timestamp(row.get("t"))[:19] + "Z"
    for field in NUMERIC_FIELDS:
        value = numeric(row.get(field))
        fixed[field] = float(value) if value is not None else None
    return opaque(host["salt"], "estimate", fixed)


def csv_row(raw):
    result = {field: raw.get(column) for field, column in CSV_FIELDS.items()}
    value = result["t"]
    if isinstance(value, str) and len(value) == 19:
        result["t"] = value.replace(" ", "T") + "Z"
    for field in NUMERIC_FIELDS:
        value = result[field]
        result[field] = float(value) if value not in (None, "") else None
    return result


def bounded_lines(stream):
    while line := stream.readline(MAX_LINE_BYTES + 1):
        if len(line) > MAX_LINE_BYTES:
            raise ValueError("oversize CSV row")
        yield line.decode("utf-8")


def load_estimates(database, host, run):
    database.execute("DELETE FROM estimates")
    with run.estimates.open("rb") as stream:
        reader = csv.DictReader(bounded_lines(stream))
        if not set(CSV_FIELDS.values()).union({"cost_usd"}) <= set(reader.fieldnames or []):
            raise ValueError("unsupported CSV header")
        for raw in reader:
            insert_estimate(database, host, raw)
    return {"price_source": "magpie-csv-snapshot", "price_snapshot_at": run.price_snapshot_at,
            "snapshot_sha256": file_digest(run.estimates)}


def insert_estimate(database, host, raw):
    if raw["cost_usd"] in (None, ""):
        return
    amount = float(raw["cost_usd"])
    if not math.isfinite(amount) or not 0 <= amount <= MAX_NUMBER:
        raise ValueError("invalid cost estimate")
    key = estimate_key(csv_row(raw), host)
    database.execute("""INSERT INTO estimates VALUES (?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET matches=matches+1""", (key, amount))


def revoke_ambiguous(database):
    candidates = database.execute("""SELECT id, day, event FROM events WHERE estimate_key IN (
        SELECT DISTINCT e.estimate_key FROM events e JOIN dirty d ON e.day=d.day
        WHERE (SELECT COUNT(*) FROM events sibling WHERE sibling.estimate_key=e.estimate_key)>1)""")
    for identifier, day, encoded in candidates:
        event = json.loads(encoded)
        if event["cost"]["estimate_usd"] is None:
            continue
        event["cost"] = unknown_cost()
        database.execute("UPDATE events SET event=? WHERE id=?", (encode(event), identifier))
        database.execute("INSERT OR IGNORE INTO dirty VALUES (?)", (day,))


def apply_estimates(database, host, run):
    revoke_ambiguous(database)
    if run.estimates is None:
        return
    provenance = load_estimates(database, host, run)
    candidates = database.execute("""SELECT e.id, e.day, e.event, p.amount FROM events e
        JOIN estimates p ON e.estimate_key=p.key WHERE p.matches=1
        AND (SELECT COUNT(*) FROM events sibling WHERE sibling.estimate_key=e.estimate_key)=1""")
    for identifier, day, encoded, amount in candidates:
        event = json.loads(encoded)
        if event["cost"]["estimate_usd"] is not None:
            continue
        event["cost"] = {**event["cost"], **provenance, "estimate_usd": amount}
        database.execute("UPDATE events SET event=? WHERE id=?", (encode(event), identifier))
        database.execute("INSERT OR IGNORE INTO dirty VALUES (?)", (day,))
