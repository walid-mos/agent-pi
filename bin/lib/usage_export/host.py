import signal
import sys
from datetime import timedelta
from pathlib import Path

from .catalog import candidates, catalog_labels
from .cli import Parser, attempt_export, utc_now
from .host_layout import TIMEZONE, WINDOW_DAYS, host_layout
from .normalize import instant
from .publish import read_manifest
from .reconcile import reconcile
from .schema import encode
from .snapshot import price_snapshot
from .storage import database_path, read_only_database

SIGNAL_EXIT_BASE = 128
DIFFERS = "usage-export-host: a closed day differs from the Magpie snapshot. See the reconcile counts."
RUN_FAILED = "usage-export-host: run failed. No source was changed."
RECONCILE_FAILED = "usage-export-host: reconcile failed. The export itself completed."
NO_STATE = "usage-export-host: no export state yet. Run usage-export-host first."
CANDIDATES_FAILED = "usage-export-host: candidates failed. Check the catalog and private state."


def host_parser():
    root = Parser(prog="usage-export-host", description="Export this host's Magpie usage on its standard paths. No network or installation.")
    root.add_argument("command", nargs="?", choices=("run", "candidates"), default="run",
                      help="run: snapshot prices, export, reconcile. candidates: list unlabelled catalog values")
    root.add_argument("--now", default=utc_now(), help="Explicit run clock")
    return root


def present_catalog(layout):
    return layout.catalog if layout.catalog.exists() else None


def export_fields(layout, now, snapshot):
    today = instant(now).date()
    return {"ledger": layout.ledger, "state": layout.state, "output": layout.output, "timezone": TIMEZONE,
            "now": now, "start": (today - timedelta(days=WINDOW_DAYS - 1)).isoformat(),
            "through": today.isoformat(), "catalog": present_catalog(layout), "estimates": snapshot,
            "price_snapshot_at": now if snapshot else None}


def reconciled_days(layout, receipt, snapshot, now):
    if receipt is None or snapshot is None:
        return []
    try:
        return reconcile(read_manifest(layout.output), snapshot, now)
    except Exception:
        return None


def run(layout, now):
    with price_snapshot(layout.magpie) as snapshot:
        receipt, failure = attempt_export(export_fields(layout, now, snapshot.path))
        days = reconciled_days(layout, receipt, snapshot.path, now)
        if days is None:
            days, failure = [], failure or RECONCILE_FAILED
    print(encode({"export": receipt, "snapshot": snapshot.status, "reconcile": days,
                  "estimates_applied": receipt is not None and snapshot.path is not None}))
    if not failure and not all(day["matches"] for day in days):
        failure = DIFFERS
    if failure:
        print(failure, file=sys.stderr)
        return 1
    return 0


def list_candidates(layout):
    if not database_path(layout.state).is_file():
        print(NO_STATE, file=sys.stderr)
        return 1
    catalog = catalog_labels(present_catalog(layout))
    with read_only_database(layout.state) as database:
        print(encode(candidates(database, catalog)))
    return 0


def exit_on_signal(number, frame):
    raise SystemExit(SIGNAL_EXIT_BASE + number)


def main():
    # A termination signal must unwind through finally blocks so the private price snapshot is removed.
    for number in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(number, exit_on_signal)
    options = host_parser().parse_args()
    layout = host_layout(Path.home())
    try:
        if options.command == "candidates":
            return list_candidates(layout)
        return run(layout, options.now)
    except (Exception, KeyboardInterrupt):
        print(CANDIDATES_FAILED if options.command == "candidates" else RUN_FAILED, file=sys.stderr)
        return 1
