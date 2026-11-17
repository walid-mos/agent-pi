import argparse
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .catalog import bind, catalog_labels, relabel
from .errors import ExportInputError
from .estimates import apply_estimates
from .normalize import timestamp
from .publish import MAX_REPORT_DAYS, publish, read_manifest
from .scan import scan_ledger
from .schema import SCHEMA, encode
from .storage import identity, state_database

BUSY = "usage-export: state is busy with another export. Wait for it to finish."
FAILED = "usage-export: export failed. Check input format, private state, and output permissions. No source was changed."


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class Parser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, f"{self.prog.split()[0]}: invalid arguments. Run --help.\n")


def parser():
    root = Parser(prog="usage-export", description="Export local Magpie usage metadata. No network or installation.")
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
    export.add_argument("--now", default=utc_now(), help="Explicit scan clock")
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


def settings(*, ledger, state, output, start, through, timezone, now, rescan=False, catalog=None,
             estimates=None, price_snapshot_at=None):
    if bool(estimates) != bool(price_snapshot_at):
        raise ValueError("estimate snapshot needs its timestamp")
    first, last = date.fromisoformat(start), date.fromisoformat(through)
    span = (last - first).days
    if not 0 <= span < MAX_REPORT_DAYS:
        raise ValueError("invalid date window")
    state, output = (path.resolve() for path in (state, output))
    if state in output.parents or output in state.parents or state == output:
        raise ValueError("state and export must be separate")
    for source in (path.resolve() for path in (ledger, catalog, estimates) if path is not None):
        if state in source.parents or output in source.parents or source in (state, output):
            raise ValueError("source must be separate")
    return Settings(
        ledger=ledger.absolute(), state=state, output=output,
        days=tuple((first + timedelta(days=offset)).isoformat() for offset in range(span + 1)),
        zone=ZoneInfo(timezone), now=timestamp(now),
        rescan=rescan, catalog=catalog_labels(catalog), estimates=estimates,
        price_snapshot_at=timestamp(price_snapshot_at) if price_snapshot_at else None)


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


def attempt_export(fields):
    try:
        return export_usage(settings(**fields)), None
    except BlockingIOError:
        return None, BUSY
    except ExportInputError as failure:
        return None, f"usage-export: {failure}"
    except Exception:
        return None, FAILED


def main():
    try:
        options = vars(parser().parse_args())
        command = options.pop("command")
        if command == "export":
            result, failure = attempt_export(options)
            if failure:
                print(failure, file=sys.stderr)
                return 1
        else:
            result = SCHEMA if command == "schema" else read_manifest(options["output"])
        print(encode(result))
        return 0
    except (Exception, KeyboardInterrupt):
        print(FAILED, file=sys.stderr)
        return 1
