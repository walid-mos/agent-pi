import argparse
import hashlib
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .estimates import apply_estimates
from .normalize import CATEGORIES, timestamp
from .publish import MAX_REPORT_DAYS, publish, read_manifest
from .scan import scan_ledger
from .schema import SCHEMA, encode
from .storage import identity, read_json, state_database

MAX_CONFIG_BYTES = 1024 * 1024


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


def catalog_labels(path):
    if path is None:
        return {}
    catalog = read_json(path, MAX_CONFIG_BYTES)
    if not isinstance(catalog, dict) or set(catalog) - set(CATEGORIES.values()):
        raise ValueError("invalid public catalog")
    for values in catalog.values():
        if not isinstance(values, list) or not all(is_public_label(value) for value in values):
            raise ValueError("invalid public catalog")
    return {field: sorted(set(values)) for field, values in catalog.items()}


def is_public_label(value):
    return isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,119}", value) is not None


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


def bind(database, run):
    binding = {"ledger": str(run.ledger), "output": str(run.output), "timezone": run.zone.key,
               "catalog": run.catalog}
    signature = hashlib.sha256(encode(binding).encode()).hexdigest()
    saved = database.execute("SELECT value FROM metadata WHERE key='binding'").fetchone()
    if saved and saved[0] != signature:
        raise ValueError("state belongs to a different source or configuration")
    database.execute("INSERT OR IGNORE INTO metadata VALUES ('binding', ?)", (signature,))


def export_usage(run):
    with state_database(run.state) as database:
        host = identity(database)
        bind(database, run)
        scan = scan_ledger(database, host, run)
        apply_estimates(database, host, run)
        manifest = publish(database, host, run, scan)
    return {"schema_version": manifest["schema_version"], "host_uuid": manifest["host_uuid"],
            "days": len(manifest["days"]), "read_bytes": scan.read_bytes, "scan": manifest["scan"]}


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
        print("usage-export: state is busy with another export. Wait for it to finish.", file=sys.stderr)
        return 1
    except (Exception, KeyboardInterrupt):
        print("usage-export: export failed. Check input format, private state, and output permissions. No source was changed.", file=sys.stderr)
        return 1
