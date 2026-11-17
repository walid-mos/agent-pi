import json
import math
import re

VERSION = 1
DIGEST = {"type": "string", "pattern": "^[0-9a-f]{64}$"}
COUNT = {"type": "integer", "minimum": 0}
DAY = {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"}
TIME = {"type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{9}Z$"}


def choice(*values):
    return {"enum": list(values)}


def object_schema(**fields):
    return {"type": "object", "properties": fields, "required": list(fields),
            "additionalProperties": False}


def nullable(specification):
    return {"anyOf": [specification, {"type": "null"}]}


NUMBER = nullable({"type": "number", "minimum": 0})

REFERENCE = nullable(DIGEST)
CATEGORY = object_schema(ref=REFERENCE, label=nullable({"type": "string", "maxLength": 120}))
TOKENS = object_schema(**{kind: nullable(COUNT) for kind in
                         ("input", "output", "cache_read", "cache_write", "cache_write_1h", "reasoning")})
COST = object_schema(estimate_usd=NUMBER, billed_usd={"type": "null"}, currency=choice("USD"),
                     interpretation=choice("api-equivalent"),
                     price_source=choice("unavailable", "magpie-csv-snapshot"),
                     price_snapshot_at=nullable(TIME), snapshot_sha256=REFERENCE)
EVENT = object_schema(
    schema_version=choice(VERSION), event_id=DIGEST, host_uuid=DIGEST,
    source=choice("magpie-ledger"), source_ref=DIGEST, ts_utc=TIME, report_day=DAY,
    kind=choice("workload", "routing-overhead"), agent=CATEGORY,
    requested_model=CATEGORY, served_model=CATEGORY, provider=CATEGORY,
    session_ref=REFERENCE, account_ref=REFERENCE, worker_ref={"type": "null"},
    project_ref={"type": "null"}, billing_mode=choice("unknown"), tokens=TOKENS,
    duration_ms=NUMBER, ttft_ms=NUMBER, status=nullable(COUNT), cost=COST,
    response_ref=REFERENCE, request_ref=REFERENCE,
)
TOTAL = object_schema(events=COUNT, unpriced_events=COUNT, missing_token_events=COUNT,
                      missing_duration_events=COUNT, estimate_usd=NUMBER, request_ms_sum=NUMBER,
                      tokens=TOKENS)
DAY_ENTRY = object_schema(
    day=DAY, coverage=choice("partial", "missing"),
    file=nullable({"type": "string", "pattern": "^days/\\d{4}-\\d{2}-\\d{2}-[0-9a-f]{64}\\.jsonl\\.gz$"}),
    sha256=REFERENCE, bytes=nullable(COUNT), workload=nullable(TOTAL), overhead=nullable(TOTAL),
    late_events=COUNT, conflicting_id_events=COUNT,
)
MANIFEST = object_schema(
    schema_version=choice(VERSION), host_uuid=DIGEST, source_ref=DIGEST,
    source=choice("magpie-ledger"), report_timezone={"type": "string", "maxLength": 100},
    last_scan_at=TIME, first_event_at=nullable(TIME), last_event_at=nullable(TIME),
    source_retention=choice("unknown"), history=choice("partial"),
    identity_semantics=choice("host-source-fingerprint-partial-ids"),
    attribution=choice("ledger-only"), direct_usage=choice("not-collected"),
    scan=object_schema(ledger_bytes=COUNT, invalid_rows=COUNT, ignored_rows=COUNT,
                       duplicate_rows=COUNT, deferred_tail_bytes=COUNT),
    days={"type": "array", "items": DAY_ENTRY},
)
SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema",
          "$id": "urn:agent-pi:usage-export:1", "$defs": {"event": EVENT, "manifest": MANIFEST}}


def validate(value, specification):
    if "anyOf" in specification:
        if not any(is_valid(value, option) for option in specification["anyOf"]):
            raise ValueError("schema violation")
        return
    if "enum" in specification:
        if value not in specification["enum"] or isinstance(value, bool):
            raise ValueError("schema violation")
        return
    kind = specification["type"]
    validators = {"null": lambda: value is None, "string": lambda: isinstance(value, str),
                  "integer": lambda: type(value) is int,
                  "number": lambda: type(value) in (int, float) and math.isfinite(value),
                  "object": lambda: isinstance(value, dict), "array": lambda: isinstance(value, list)}
    if not validators[kind]():
        raise ValueError("schema violation")
    validate_constraints(value, specification)


def validate_constraints(value, specification):
    if isinstance(value, dict):
        fields = specification["properties"]
        if value.keys() != fields.keys():
            raise ValueError("schema violation")
        for key, item in value.items():
            validate(item, fields[key])
    if isinstance(value, list):
        for item in value:
            validate(item, specification["items"])
    if isinstance(value, str):
        if len(value) > specification.get("maxLength", 1000):
            raise ValueError("schema violation")
        if "pattern" in specification and not re.fullmatch(specification["pattern"], value, re.ASCII):
            raise ValueError("schema violation")
    if type(value) in (int, float) and value < specification.get("minimum", value):
        raise ValueError("schema violation")


def is_valid(value, specification):
    try:
        validate(value, specification)
        return True
    except ValueError:
        return False


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
