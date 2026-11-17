import hashlib
import hmac
import re
from datetime import datetime, timezone

from .schema import TOKENS, VERSION, encode

MAX_NUMBER = 9_007_199_254_740_991
TOKEN_FIELDS = {kind: {"input": "in", "output": "out"}.get(kind, kind) for kind in TOKENS["properties"]}
STAMP = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$")
IDENTITY_FIELDS = ("t", "req", "model", "served", "provider", "agent", "session", "native_session",
                   "providerAccount", "providerKeyId", "kind", "ms", "ttft_ms", "status", "response_id",
                   "rid", "route_id", *TOKEN_FIELDS.values())


def timestamp(value):
    if not isinstance(value, str) or not (match := STAMP.fullmatch(value)):
        raise ValueError("expected timestamp with timezone")
    seconds, fraction, offset = match.groups()
    moment = datetime.fromisoformat(seconds + offset).astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S") + "." + (fraction or "").ljust(9, "0") + "Z"


def instant(value):
    return datetime.fromisoformat(timestamp(value))


def numeric(value):
    if type(value) not in (int, float) or not 0 <= value <= MAX_NUMBER:
        return None
    return value


def count(value):
    amount = numeric(value)
    if amount is None or int(amount) != amount:
        return None
    return int(amount)


def text(value):
    if isinstance(value, str) and 0 < len(value) <= 1000:
        return value
    return None


def opaque(secret, namespace, value):
    if value is None or value == "":
        return None
    return hmac.new(secret, encode([namespace, value]).encode(), hashlib.sha256).hexdigest()


def reference(row, field, identity, database):
    value = text(row.get(field))
    result = opaque(identity["salt"], field, value)
    if result:
        database.execute("INSERT OR IGNORE INTO mappings VALUES (?, ?, ?)", (field, result, value))
    return result


def category(row, field, identity, database, catalog):
    value = text(row.get(field))
    return {"ref": reference(row, field, identity, database),
            "label": value if value in catalog.get(field, []) else None}


def unknown_cost():
    return {"estimate_usd": None, "billed_usd": None, "currency": "USD",
            "interpretation": "api-equivalent", "price_source": "unavailable",
            "price_snapshot_at": None, "snapshot_sha256": None}


def normalize(row, identity, database, zone, catalog):
    if not isinstance(row, dict):
        raise ValueError("expected ledger object")
    if row.get("kind", "") not in ("", "routing", "compact"):
        return None
    stamp = timestamp(row.get("t"))
    fixed = {field: row.get(field) for field in IDENTITY_FIELDS}
    fixed["t"] = stamp
    identifier = opaque(identity["salt"], identity["source_ref"], fixed)
    return {
        "schema_version": VERSION, "event_id": identifier, "host_uuid": identity["host_uuid"],
        "source": "magpie-ledger", "source_ref": identity["source_ref"], "ts_utc": stamp,
        "report_day": instant(stamp).astimezone(zone).date().isoformat(),
        "kind": "routing-overhead" if row.get("kind") == "routing" else "workload",
        "agent": category(row, "agent", identity, database, catalog),
        "requested_model": category(row, "req", identity, database, catalog),
        "served_model": category(row, "served", identity, database, catalog),
        "provider": category(row, "provider", identity, database, catalog),
        "session_ref": reference(row, "session", identity, database),
        "account_ref": reference(row, "providerAccount", identity, database)
                       or reference(row, "providerKeyId", identity, database),
        "worker_ref": None, "project_ref": None, "billing_mode": "unknown",
        "tokens": {kind: count(row.get(field)) for kind, field in TOKEN_FIELDS.items()},
        "duration_ms": numeric(row.get("ms")), "ttft_ms": numeric(row.get("ttft_ms")),
        "status": count(row.get("status")), "cost": unknown_cost(),
        "response_ref": reference(row, "response_id", identity, database),
        "request_ref": reference(row, "rid", identity, database),
    }
