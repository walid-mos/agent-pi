import gzip
import json
import subprocess
import sys

from support import CANARY, NOW, ROOT, ExportCase

HOST_CLI = ROOT / "bin" / "usage-export-host"
FAKE_MAGPIE = """#!{python}
import pathlib
import sys
here = pathlib.Path(sys.argv[0]).resolve().parent
(here / "magpie.args").write_text(" ".join(sys.argv[1:]))
sys.stderr.write({canary!r})
if (here / "magpie.fifo").exists():
    with (here / "magpie.fifo").open() as stream:
        stream.read()
if (here / "magpie.fail").exists():
    sys.stdout.write("time,partial")
    sys.exit(3)
sys.stdout.write((here / "magpie.csv").read_text())
"""


class HostCase(ExportCase):
    def setUp(self):
        super().setUp()
        self.home = self.fixture / ("home-" + CANARY)
        self.ledger = self.home / ".config" / "magpie" / "usage.jsonl"
        self.state = self.home / ".local" / "state" / "agent-usage-export"
        self.output = self.home / "Public" / "deliverables" / "agent-usage-export" / "v1"
        self.catalog = self.home / ".config" / "agent-usage-export" / "catalog.json"
        self.bin = self.fixture / "bin"
        self.temporary = self.fixture / "tmp"
        for directory in (self.ledger.parent, self.catalog.parent, self.bin, self.temporary):
            directory.mkdir(parents=True)
        self.ledger.write_text("")

    def environment(self):
        return {"HOME": str(self.home), "PATH": str(self.bin), "TMPDIR": str(self.temporary)}

    def run_host(self, *arguments, now=NOW, expected=0):
        result = self.invoke([sys.executable, "-B", str(HOST_CLI), *arguments, "--now", now], self.environment())
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def start_host(self):
        process = subprocess.Popen([sys.executable, "-B", str(HOST_CLI), "--now", NOW], env=self.environment(),
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.record_process(process)
        self.addCleanup(self.stop, process)
        return process

    def receipt(self, *arguments, now=NOW, expected=0):
        return json.loads(self.run_host(*arguments, now=now, expected=expected).stdout)

    def install_magpie(self, rows, directory=None, is_failing=False):
        directory = directory or self.bin
        directory.mkdir(parents=True, exist_ok=True)
        executable = directory / "magpie"
        executable.write_text(FAKE_MAGPIE.format(python=sys.executable, canary=CANARY))
        executable.chmod(0o700)
        self.estimates([self.csv_row(row) for row in rows], "magpie.csv", directory=directory)
        if is_failing:
            (directory / "magpie.fail").write_text("")
        return directory

    def csv_row(self, row, cost="0.25"):
        fields = ("req", "provider", "served", "in", "out", "cache_read", "cache_write", "cache_write_1h",
                  "reasoning", "ms", "status", "response_id", "rid", "kind")
        return [row["t"][:19].replace("T", " "), *(row.get(field, "") for field in fields), cost]

    def published(self):
        return {str(path.relative_to(self.output)): path.read_bytes()
                for path in sorted(self.output.rglob("*")) if path.is_file()}

    def published_text(self):
        names = " ".join(self.published())
        contents = [gzip.decompress(body) if name.endswith(".gz") else body
                    for name, body in self.published().items()]
        return names + b"".join(contents).decode()
