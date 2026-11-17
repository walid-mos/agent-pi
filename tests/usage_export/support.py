import csv
import gzip
import json
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "bin" / "usage-export"
NOW = "2026-11-18T12:00:00Z"
CANARY = "private-client-branch@example.invalid"
ESTIMATE_HEADERS = ["time", "requested_model", "provider", "served_model", "input_tokens", "output_tokens",
                    "cache_read_tokens", "cache_write_tokens", "cache_write_1h_tokens", "reasoning_tokens",
                    "duration_ms", "status", "response_id", "request_id", "kind", "cost_usd"]


class ExportCase(unittest.TestCase):
    def setUp(self):
        self.run_id = str(uuid.uuid4())
        self.root = Path(tempfile.mkdtemp(prefix="feat-daily-usage-export-"))
        self.addCleanup(self.cleanup_owned)
        self.fixture = self.root / "fixture"
        self.fixture.mkdir()
        (self.fixture / ".owner").write_text(self.run_id)
        (self.root / "ownership.json").write_text(json.dumps({
            "run_id": self.run_id, "path": str(self.fixture), "endpoint": None,
        }))
        self.ledger = self.fixture / "ledger.jsonl"
        self.state = self.fixture / "state"
        self.output = self.fixture / "export"
        self.ledger.write_text("")

    def cleanup_owned(self):
        receipt = json.loads((self.root / "ownership.json").read_text())
        self.assertEqual(receipt["run_id"], self.run_id)
        self.assertEqual(receipt["path"], str(self.fixture))
        self.assertEqual((self.fixture / ".owner").read_text(), self.run_id)
        shutil.rmtree(self.root)

    def row(self, **changes):
        return {"t": "2026-11-17T23:30:00.123456789Z", "agent": "pi",
                "req": "group/router", "model": "gpt-6.1-sol", "served": "gpt-6.1-sol",
                "provider": "codex", "in": 100, "out": 20, "cache_read": 10,
                "cache_write": 4, "cache_write_1h": 1, "reasoning": 5,
                "ms": 250, "status": 200, "response_id": "response-a", **changes}

    def append(self, *rows):
        with self.ledger.open("a") as stream:
            for row in rows:
                stream.write(json.dumps(row) + "\n")

    def record_process(self, process):
        receipt_path = self.root / "ownership.json"
        receipt = json.loads(receipt_path.read_text())
        receipt.setdefault("processes", []).append({"pid": process.pid, "started_at_ns": time.time_ns(), "endpoint": None})
        receipt_path.write_text(json.dumps(receipt))

    def invoke(self, arguments, environment=None):
        with subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                              env=environment) as process:
            self.record_process(process)
            try:
                stdout, stderr = process.communicate(timeout=30)
            finally:
                self.stop(process)
            return subprocess.CompletedProcess(arguments, process.returncode, stdout, stderr)

    def stop(self, process):
        if process.poll() is None:
            process.kill()
        process.wait()

    def run_cli(self, *extra, expected=0):
        arguments = ["python3", "-B", str(CLI), "export", "--ledger", str(self.ledger),
                     "--state", str(self.state), "--output", str(self.output),
                     "--from", "2026-11-16", "--through", "2026-11-18",
                     "--timezone", "Europe/Paris", "--now", NOW, *extra]
        result = self.invoke(arguments)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def estimates(self, rows, name="estimates.csv", encoding="utf-8", directory=None):
        path = (directory or self.fixture) / name
        with path.open("w", newline="", encoding=encoding) as stream:
            writer = csv.writer(stream)
            writer.writerow(ESTIMATE_HEADERS)
            writer.writerows(rows)
        return path

    def manifest(self):
        return json.loads((self.output / "manifest.json").read_text())

    def events(self):
        events = []
        for day in self.manifest()["days"]:
            if day["file"] is not None:
                content = gzip.decompress((self.output / day["file"]).read_bytes())
                events.extend(json.loads(line) for line in content.splitlines())
        return events
