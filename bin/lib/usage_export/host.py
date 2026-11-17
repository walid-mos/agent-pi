import argparse
import signal
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .catalog import candidates, catalog_labels
from .cli import BUSY, FAILED, export_usage, parser, settings
from .host_layout import TIMEZONE, WINDOW_DAYS, host_layout
from .normalize import instant
from .publish import read_manifest
from .reconcile import reconcile
from .schema import encode
from .snapshot import price_snapshot
from .storage import read_only_database

SIGNAL_EXIT_BASE = 128
DIFFERS = "usage-export-host: a closed day differs from the Magpie snapshot. See the reconcile counts."
RUN_FAILED = "usage-export-host: run failed. No source was changed."
NO_STATE = "usage-export-host: no export state yet. Run usage-export-host first."
CANDIDATES_FAILED = "usage-export-host: candidates failed. Check the catalog and private state."


class HostParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "usage-export-host: invalid arguments. Run --help.\n")


def host_parser():
    root = HostParser(description="Export this host's Magpie usage on its standard paths. No network or installation.")
    root.add_argument("command", nargs="?", choices=("run", "candidates"), default="run",
                      help="run: snapshot prices, export, reconcile. candidates: list unlabelled catalog values")
    root.add_argument("--now", default=datetime.now(timezone.utc).isoformat(), help="Explicit run clock")
    return root


def present_catalog(layout):
    return layout.catalog if layout.catalog.exists() else None


def export_arguments(layout, now, snapshot):
    today = instant(now).date()
    arguments = ["export", "--ledger", str(layout.ledger), "--state", str(layout.state),
                 "--output", str(layout.output), "--timezone", TIMEZONE, "--now", now,
                 "--from", (today - timedelta(days=WINDOW_DAYS - 1)).isoformat(), "--through", today.isoformat()]
    if present_catalog(layout):
        arguments += ["--catalog", str(layout.catalog)]
    if snapshot:
        arguments += ["--estimates", str(snapshot), "--price-snapshot-at", now]
    return arguments


def attempt_export(arguments):
    try:
        return export_usage(settings(parser().parse_args(arguments))), None
    except BlockingIOError:
        return None, BUSY
    except Exception:
        return None, FAILED


def run(layout, now):
    with price_snapshot(layout.magpie) as snapshot:
        receipt, failure = attempt_export(export_arguments(layout, now, snapshot.path))
        days = reconcile(read_manifest(layout.output), snapshot.path, now) if receipt and snapshot.path else []
    print(encode({"export": receipt, "snapshot": snapshot.status, "reconcile": days,
                  "estimates_applied": receipt is not None and snapshot.path is not None}))
    if not failure and not all(day["matches"] for day in days):
        failure = DIFFERS
    if failure:
        print(failure, file=sys.stderr)
        return 1
    return 0


def list_candidates(layout):
    if not (layout.state / "usage.sqlite").is_file():
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
