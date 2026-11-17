import json
import subprocess
import sys
from unittest.mock import patch

from support import CLI, ROOT, ExportCase

sys.path.insert(0, str(ROOT / "bin" / "lib"))
from usage_export.cli import main


class RecoveryTests(ExportCase):
    def test_oversized_and_malformed_rows_are_skipped_without_blocking_later_events(self):
        with self.ledger.open("wb") as stream:
            stream.write(b"x" * (1024 * 1024 + 20) + b"\n")
            stream.write(b'{"t":"secret-canary-path",\n')
        self.append(self.row())
        self.run_cli()
        self.assertEqual(len(self.events()), 1)
        self.assertEqual(self.manifest()["scan"]["invalid_rows"], 2)
        self.assertEqual(self.manifest()["scan"]["deferred_tail_bytes"], 0)

    def test_failed_manifest_replace_preserves_the_previous_snapshot_and_retry_recovers(self):
        self.append(self.row())
        self.run_cli()
        previous = (self.output / "manifest.json").read_bytes()
        self.append(self.row(t="2026-11-18T01:00:00Z", response_id="next"))
        import os
        replace = os.replace

        def interrupt_manifest(source, destination):
            if str(destination).endswith("manifest.json"):
                raise KeyboardInterrupt()
            return replace(source, destination)

        arguments = [str(CLI), "export", "--ledger", str(self.ledger), "--state", str(self.state),
                     "--output", str(self.output), "--from", "2026-11-16", "--through", "2026-11-18",
                     "--timezone", "Europe/Paris", "--now", "2026-11-18T12:00:00Z"]
        with patch.object(sys, "argv", arguments), patch("os.replace", interrupt_manifest):
            self.assertEqual(main(), 1)
        self.assertEqual((self.output / "manifest.json").read_bytes(), previous)
        self.assertEqual(len(self.events()), 1)
        self.run_cli()
        self.assertEqual(len(self.events()), 2)
        self.assertEqual(list(self.output.rglob(".pending-*")), [])

    def test_repeat_scan_is_byte_identical_and_reads_no_completed_rows(self):
        self.append(self.row(), self.row(), self.row(t="2026-11-17T20:00:00Z", route_id=1, response_id=""))
        self.run_cli()
        before = {str(path): path.read_bytes() for path in self.output.rglob("*") if path.is_file()}
        result = self.run_cli("--now", "2026-11-19T12:00:00Z")
        self.assertEqual(json.loads(result.stdout)["read_bytes"], 0)
        self.assertEqual(before, {str(path): path.read_bytes() for path in self.output.rglob("*") if path.is_file()})
        self.assertEqual(self.manifest()["scan"]["duplicate_rows"], 1)
        self.assertEqual(len(self.events()), 2)

    def test_invalid_arguments_and_source_errors_do_not_quote_private_paths(self):
        canary = "secret-client@example.invalid"
        result = subprocess.run(["python3", "-B", str(CLI), "--" + canary], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(canary, result.stdout + result.stderr)
        self.ledger = self.fixture / canary
        result = self.run_cli(expected=1)
        self.assertNotIn(canary, result.stdout + result.stderr)
