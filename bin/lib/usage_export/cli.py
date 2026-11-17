import argparse
import hashlib
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .estimates import apply_estimates
from .normalize import timestamp
from .publish import publish
from .scan import scan_ledger
from .schema import MANIFEST, SCHEMA, encode, validate
from .storage import identity, private_directory, state_database

MAX_CONFIG_BYTES = 1024 * 1024
MAX_REPORT_DAYS = 3660


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


def read_config(path):
    with path.open("rb") as stream:
        encoded = stream.read(MAX_CONFIG_BYTES + 1)
    if len(encoded) > MAX_CONFIG_BYTES:
        raise ValueError("configuration too large")
    return json.loads(encoded)


def catalog_labels(path):
    if path is None:
        return {}
    catalog = read_config(path)
    if not isinstance(catalog, dict) or set(catalog) - {"req", "served", "provider", "agent"}:
        raise ValueError("invalid public catalog")
    for values in catalog.values():
        if not isinstance(values, list) or not all(is_public_label(value) for value in values):
            raise ValueError("invalid public catalog")
    return catalog


def is_public_label(value):
    import re
    return isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,119}", value) is not None


def check_options(options):
    options.now = timestamp(options.now)
    if bool(options.estimates) != bool(options.price_snapshot_at):
        raise ValueError("estimate snapshot needs its timestamp")
    if options.price_snapshot_at:
        options.price_snapshot_at = timestamp(options.price_snapshot_at)
    options.zone = ZoneInfo(options.timezone)
    first, last = date.fromisoformat(options.start), date.fromisoformat(options.through)
    if not 0 <= (last - first).days < MAX_REPORT_DAYS:
        raise ValueError("invalid date window")
    ledger, state, output = (path.resolve() for path in (options.ledger, options.state, options.output))
    if state in output.parents or output in state.parents or state == output:
        raise ValueError("state and export must be separate")
    sources = [options.ledger, options.catalog, options.estimates]
    for source in (path.resolve() for path in sources if path is not None):
        if state in source.parents or output in source.parents or source in (state, output):
            raise ValueError("source must be separate")
    return {"ledger": str(ledger), "output": str(output), "timezone": options.timezone}


def bind(database, binding, catalog):
    signature = hashlib.sha256(encode({**binding, "catalog": catalog}).encode()).hexdigest()
    saved = database.execute("SELECT value FROM metadata WHERE key='binding'").fetchone()
    if saved and saved[0] != signature:
        raise ValueError("state belongs to a different source or configuration")
    database.execute("INSERT OR IGNORE INTO metadata VALUES ('binding', ?)", (signature,))


def export_usage(options):
    binding = check_options(options)
    catalog = catalog_labels(options.catalog)
    private_directory(options.state)
    private_directory(options.output)
    private_directory(options.output / "days")
    with state_database(options.state) as database:
        host = identity(database)
        bind(database, binding, catalog)
        scan = scan_ledger(database, host, options, catalog)
        apply_estimates(database, host, options)
        manifest = publish(database, host, options, scan)
    return manifest


def main():
    try:
        options = parser().parse_args()
        if options.command == "schema":
            print(encode(SCHEMA))
            return 0
        if options.command == "coverage":
            manifest = read_config(options.output / "manifest.json")
            validate(manifest, MANIFEST)
            print(encode(manifest))
            return 0
        manifest = export_usage(options)
        print(encode({"schema_version": manifest["schema_version"], "host_uuid": manifest["host_uuid"],
                      "days": len(manifest["days"]), "read_bytes": options.read_bytes, "scan": manifest["scan"]}))
        return 0
    except (Exception, KeyboardInterrupt):
        print("usage-export: export failed. Check input format, private state, and output permissions. No source was changed.", file=sys.stderr)
        return 1
