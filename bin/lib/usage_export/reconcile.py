from datetime import timedelta

from .estimates import CSV_FIELDS, csv_instant, csv_rows
from .normalize import KINDS, TOKEN_FIELDS, count, instant

SETTLE = timedelta(hours=1)
TOKEN_COLUMNS = {kind: CSV_FIELDS[field] for kind, field in TOKEN_FIELDS.items()}


def empty_counts():
    return {"requests": 0, **dict.fromkeys(TOKEN_COLUMNS, 0)}


def token_count(value):
    try:
        return count(float(value)) or 0
    except (TypeError, ValueError):
        return 0


def accumulate(counts_by_day, day, row):
    counts = counts_by_day.setdefault(day, empty_counts())
    counts["requests"] += 1
    for kind, column in TOKEN_COLUMNS.items():
        counts[kind] += token_count(row.get(column))


def add_row(rows, unique, seen, row, days):
    stamp = csv_instant(row.get(CSV_FIELDS["t"]))
    if stamp is None or (row.get(CSV_FIELDS["kind"]) or "") not in KINDS:
        return None
    day = stamp[:10]
    if day in days:
        accumulate(rows, day, row)
        identity = tuple(row.get(column) for column in CSV_FIELDS.values())
        if identity not in seen:
            seen.add(identity)
            accumulate(unique, day, row)
    return day


def snapshot_counts(snapshot, days):
    rows, unique, seen, first = {}, {}, set(), None
    with snapshot.open("rb") as stream:
        for row in csv_rows(stream):
            day = add_row(rows, unique, seen, row, days)
            if day is not None and (first is None or day < first):
                first = day
    return rows, unique, first


def exported_counts(entry):
    counts = empty_counts()
    for total in (entry["workload"], entry["overhead"]):
        if total is None:
            continue
        counts["requests"] += total["events"]
        for kind in TOKEN_COLUMNS:
            counts[kind] += total["tokens"][kind] or 0
    return counts


def window_days(manifest, snapshot_at):
    settled = (instant(snapshot_at) - SETTLE).date().isoformat()
    first = (manifest["first_event_at"] or "")[:10]
    return [entry["day"] for entry in manifest["days"] if first < entry["day"] < settled]


def day_result(day, rows, unique, entry):
    exported = exported_counts(entry)
    return {"day": day, "matches": exported in (rows[day], unique[day]),
            "csv": rows[day], "csv_unique": unique[day], "export": exported}


def compared_days(days, rows, cut_off):
    return [day for day in days if day in rows and day != cut_off]


def reconcile(manifest, snapshot, snapshot_at):
    days = window_days(manifest, snapshot_at)
    rows, unique, cut_off = snapshot_counts(snapshot, set(days))
    entries = {entry["day"]: entry for entry in manifest["days"]}
    return [day_result(day, rows, unique, entries[day]) for day in compared_days(days, rows, cut_off)]
