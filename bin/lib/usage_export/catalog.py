import hashlib
import json
import re

from .errors import ExportInputError
from .normalize import CATEGORIES
from .schema import LABEL_MAX_LENGTH, encode
from .storage import database_path, load_metadata, read_json, rewrite_event, save_metadata

MAX_CONFIG_BYTES = 1024 * 1024
RELABEL_BATCH = 500
EVENT_FIELDS = {source: field for field, source in CATEGORIES.items()}
LABELLED = """SELECT e.id, e.day, e.event, m.value FROM events e
    JOIN mappings m ON m.kind=? AND m.ref=json_extract(e.event, ?)
    WHERE e.id > ? AND m.value IN (SELECT value FROM json_each(?)) ORDER BY e.id LIMIT ?"""
UNLABELLED = """SELECT m.value, COUNT(*) FROM events e
    JOIN mappings m ON m.kind=? AND m.ref=json_extract(e.event, ?)
    WHERE m.value NOT IN (SELECT value FROM json_each(?))
    GROUP BY m.value ORDER BY COUNT(*) DESC, m.value"""


def catalog_labels(path):
    if path is None:
        return {}
    catalog = read_json(path, MAX_CONFIG_BYTES)
    if not isinstance(catalog, dict) or set(catalog) - set(EVENT_FIELDS):
        raise ValueError("invalid public catalog")
    for values in catalog.values():
        if not isinstance(values, list) or not all(is_public_label(value) for value in values):
            raise ValueError("invalid public catalog")
    return {field: sorted(set(values)) for field, values in catalog.items() if values}


def is_public_label(value):
    return isinstance(value, str) and re.fullmatch(rf"[a-zA-Z0-9][a-zA-Z0-9._:/+-]{{0,{LABEL_MAX_LENGTH - 1}}}", value) is not None


def bind(database, run):
    source = {"ledger": str(run.ledger), "output": str(run.output), "timezone": run.zone.key}
    signature = hashlib.sha256(encode(source).encode()).hexdigest()
    bound = load_metadata(database, "binding") or {"source": signature, "catalog": {}}
    if isinstance(bound, str) and re.fullmatch(r"[0-9a-f]{64}", bound):
        raise ExportInputError(f"State {database_path(run.state)} was written by an older version. "
                               "Preserve it and use a new state directory before retrying.")
    if bound["source"] != signature or not is_extension(run.catalog, bound["catalog"]):
        raise ValueError("state belongs to a different source or configuration")
    save_metadata(database, "binding", {"source": signature, "catalog": run.catalog})
    return {field: sorted(set(labels) - set(bound["catalog"].get(field, [])))
            for field, labels in run.catalog.items()}


def is_extension(catalog, bound):
    return all(set(labels) <= set(catalog.get(field, [])) for field, labels in bound.items())


def relabel(database, added):
    database.execute("CREATE TEMP TABLE relabelled (id TEXT PRIMARY KEY)")
    try:
        for field, labels in added.items():
            if labels:
                relabel_field(database, field, labels)
        return database.execute("SELECT COUNT(*) FROM relabelled").fetchone()[0]
    finally:
        database.execute("DROP TABLE relabelled")


def relabel_field(database, source, labels):
    field, last = EVENT_FIELDS[source], ""
    while batch := database.execute(LABELLED, (source, f"$.{field}.ref", last, encode(labels),
                                               RELABEL_BATCH)).fetchall():
        for identifier, day, encoded, label in batch:
            event = json.loads(encoded)
            event[field]["label"] = label
            rewrite_event(database, identifier, day, event)
            database.execute("INSERT OR IGNORE INTO relabelled VALUES (?)", (identifier,))
        last = batch[-1][0]


def candidates(database, catalog):
    return {source: [{"value": value, "events": events} for value, events in database.execute(
                UNLABELLED, (source, f"$.{field}.ref", encode(catalog.get(source, []))))]
            for source, field in EVENT_FIELDS.items()}
