import argparse
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .catalog import bind, catalog_labels, relabel
from .estimates import apply_estimates
from .normalize import timestamp
from .publish import MAX_REPORT_DAYS, publish, read_manifest
from .scan import scan_ledger
from .schema import SCHEMA, encode
from .storage import identity, state_database

BUSY = "usage-export: state is busy with another export. Wait for it to finish."
FAILED = "usage-export: export failed. Check input format, private state, and output permissions. No source was changed."


class Parser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "usage-export: invalid arguments. Run --help.\n")


def parser():
    root = Parser(description="Export local Magpie usage metadata. No network or installation.")
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("schema", help="Print the authoritative event and manifest JSON Schema")
    coverage = commands.add_parser("coverage", help="Validate and print a published coverage manifest")
    coverage.add_argument("--output", type=Path, required=True)
    export = commands.add_parser("export", help="Incrementally scan a local ledger and publish UTC day files")
    export.add_argument("--ledger", type=Path, required=True)
    export.add_argument("--state", type=Path, required=True)
    export.add_argument("--output", type=Path, required=True)
    export.add_argument("--from", dest="start", required=True, help="First UTC date to list")
    export.add_argument("--through", required=True, help="Last UTC date to list, inclusive")
    export.add_argument("--timezone", required=True, help="IANA report timezone")
    export.add_argument("--now", default=datetime.now(timezone.utc).isoformat(), help="Explicit scan clock")
    export.add_argument("--rescan", action="store_true", help="Reconcile the entire retained ledger")
    export.add_argument("--catalog", type=Path, help="Reviewed public categorical labels")
    export.add_argument("--estimates", type=Path, help="Isolated magpie usage --csv all snapshot")
    export.add_argument("--price-snapshot-at", help="UTC time when the CSV prices were read")
    return root


@dataclass(frozen=True)
class Settings:
    ledger: Path
    state: Path
    output: Path
    days: tuple
    zone: ZoneInfo
    now: str
    rescan: bool
    catalog: dict
    estimates: Path | None
    price_snapshot_at: str | None


def settings(options):
    if bool(options.estimates) != bool(options.price_snapshot_at):
        raise ValueError("estimate snapshot needs its timestamp")
    first, last = date.fromisoformat(options.start), date.fromisoformat(options.through)
    span = (last - first).days
    if not 0 <= span < MAX_REPORT_DAYS:
        raise ValueError("invalid date window")
    ledger = options.ledger.absolute()
    state, output = (path.resolve() for path in (options.state, options.output))
    if state in output.parents or output in state.parents or state == output:
        raise ValueError("state and export must be separate")
    sources = [options.ledger, options.catalog, options.estimates]
    for source in (path.resolve() for path in sources if path is not None):
        if state in source.parents or output in source.parents or source in (state, output):
            raise ValueError("source must be separate")
    return Settings(
        ledger=ledger, state=state, output=output,
        days=tuple((first + timedelta(days=offset)).isoformat() for offset in range(span + 1)),
        zone=ZoneInfo(options.timezone), now=timestamp(options.now),
        rescan=options.rescan, catalog=catalog_labels(options.catalog), estimates=options.estimates,
        price_snapshot_at=timestamp(options.price_snapshot_at) if options.price_snapshot_at else None)


def export_usage(run):
    with state_database(run.state) as database:
        host = identity(database)
        relabelled = relabel(database, bind(database, run))
        scan = scan_ledger(database, host, run)
        apply_estimates(database, host, run)
        manifest = publish(database, host, run, scan)
    return {"schema_version": manifest["schema_version"], "host_uuid": manifest["host_uuid"],
            "days": len(manifest["days"]), "read_bytes": scan.read_bytes, "scan": manifest["scan"],
            "relabelled_events": relabelled}


def main():
    try:
        options = parser().parse_args()
        if options.command == "schema":
            result = SCHEMA
        elif options.command == "coverage":
            result = read_manifest(options.output)
        else:
            result = export_usage(settings(options))
        print(encode(result))
        return 0
    except BlockingIOError:
        print(BUSY, file=sys.stderr)
        return 1
    except (Exception, KeyboardInterrupt):
        print(FAILED, file=sys.stderr)
        return 1
