from datetime import timedelta

from .estimates import CSV_FIELDS, csv_instant, csv_rows
from .normalize import KINDS, TOKEN_FIELDS, instant

SETTLE = timedelta(hours=1)
TOKEN_COLUMNS = {kind: CSV_FIELDS[field] for kind, field in TOKEN_FIELDS.items()}


def empty_counts():
    return {"requests": 0, **dict.fromkeys(TOKEN_COLUMNS, 0)}


def token_count(value):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return 0
    return int(amount) if amount.is_integer() and amount >= 0 else 0


def snapshot_counts(snapshot):
    days, seen = {}, set()
    with snapshot.open("rb") as stream:
        for row in csv_rows(stream):
            add_row(days, seen, row)
    return days


def add_row(days, seen, row):
    stamp = csv_instant(row.get(CSV_FIELDS["t"]))
    if stamp is None or (row.get(CSV_FIELDS["kind"]) or "") not in KINDS:
        return
    identity = tuple(row.get(column) for column in CSV_FIELDS.values())
    if identity in seen:
        return
    seen.add(identity)
    counts = days.setdefault(stamp[:10], empty_counts())
    counts["requests"] += 1
    for kind, column in TOKEN_COLUMNS.items():
        counts[kind] += token_count(row.get(column))


def exported_counts(entry):
    counts = empty_counts()
    for total in (entry["workload"], entry["overhead"]):
        if total is None:
            continue
        counts["requests"] += total["events"]
        for kind in TOKEN_COLUMNS:
            counts[kind] += total["tokens"][kind] or 0
    return counts


def covered_days(manifest, snapshot_days, snapshot_at):
    if not snapshot_days:
        return []
    first_days = [min(snapshot_days), (manifest["first_event_at"] or "")[:10]]
    settled = (instant(snapshot_at) - SETTLE).date().isoformat()
    return [entry for entry in manifest["days"] if max(first_days) < entry["day"] < settled]


def reconcile(manifest, snapshot, snapshot_at):
    snapshot_days = snapshot_counts(snapshot)
    results = []
    for entry in covered_days(manifest, snapshot_days, snapshot_at):
        expected, exported = snapshot_days.get(entry["day"], empty_counts()), exported_counts(entry)
        results.append({"day": entry["day"], "matches": expected == exported, "csv": expected, "export": exported})
    return results
