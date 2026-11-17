import fcntl
import json
import os
import sys
from pathlib import Path

from support import CLI, ExportCase

VALUES = ["2026-11-17 23:30:00", "group/router", "codex", "gpt-6.1-sol", 100, 20, 10, 4, 1, 5,
          250, 200, "response-a", "", "", "0.25"]


class ReviewFixTests(ExportCase):
    def test_deleted_or_corrupted_day_files_are_rebuilt_from_private_state(self):
        self.append(self.row())
        self.run_cli()
        published = next((self.output / "days").iterdir())
        published.write_bytes(b"corrupted")
        self.run_cli()
        self.assertNotEqual(published.read_bytes(), b"corrupted")
        for entry in self.manifest()["days"]:
            if entry["file"]:
                self.assertTrue((self.output / entry["file"]).is_file())
        for path in (self.output / "days").iterdir():
            path.unlink()
        self.run_cli()
        entry = self.manifest()["days"][1]
        self.assertTrue((self.output / entry["file"]).is_file())
        self.assertEqual(len(self.events()), 1)

    def test_rotating_a_symlinked_ledger_keeps_the_state_binding(self):
        self.ledger = self.fixture / "current.jsonl"
        first = self.fixture / "first.jsonl"
        second = self.fixture / "second.jsonl"
        first.write_text(json.dumps(self.row()) + "\n")
        second.write_text(json.dumps(self.row(t="2026-11-18T08:00:00Z", response_id="next")) + "\n")
        self.ledger.symlink_to(first)
        self.run_cli()
        self.ledger.unlink()
        self.ledger.symlink_to(second)
        self.run_cli()
        self.assertEqual(len(self.events()), 2)

    def test_an_ambiguous_newer_snapshot_revokes_a_frozen_price(self):
        self.append(self.row())
        snapshot = self.estimates([VALUES])
        self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
        self.assertEqual(self.events()[0]["cost"]["estimate_usd"], 0.25)
        self.estimates([VALUES, VALUES])
        self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-19T10:00:00Z")
        self.assertIsNone(self.events()[0]["cost"]["estimate_usd"])
        self.assertIsNone(self.manifest()["days"][1]["workload"]["estimate_usd"])

    def test_fractional_and_bom_csv_input_prices_and_bad_times_stay_unknown(self):
        fractional = [*VALUES]
        fractional[0] = "2026-11-17 23:30:00.5"
        snapshot = self.estimates([fractional, [*VALUES[:0], *VALUES]], name="bom.csv", encoding="utf-8-sig")
        self.append(self.row(), self.row(t="2026-11-17T23:40:00Z", response_id="second"))
        snapshot = self.estimates([fractional, ["not-a-time", *VALUES[1:]]], name="mixed.csv")
        self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
        priced = [event["cost"]["estimate_usd"] for event in self.events()]
        self.assertEqual(priced, [0.25, None])

    def test_catalog_order_duplicates_and_symlinked_source_do_not_rebind_state(self):
        catalog = self.fixture / "catalog.json"
        catalog.write_text(json.dumps({"served": ["gpt-6.1-sol", "claude-opus-5-5"], "req": ["group/router"]}))
        self.append(self.row())
        self.run_cli("--catalog", str(catalog))
        catalog.write_text(json.dumps({"req": ["group/router"], "served": ["claude-opus-5-5", "gpt-6.1-sol", "gpt-6.1-sol"]}))
        self.run_cli("--catalog", str(catalog))
        self.assertEqual(self.events()[0]["served_model"]["label"], "gpt-6.1-sol")

    def test_rescan_of_an_unchanged_ledger_keeps_manifest_bytes(self):
        self.append(self.row())
        self.run_cli()
        before = (self.output / "manifest.json").read_bytes()
        self.run_cli("--rescan", "--now", "2026-11-19T12:00:00Z")
        self.assertEqual((self.output / "manifest.json").read_bytes(), before)

    def test_a_busy_private_state_reports_its_cause_without_a_path(self):
        self.append(self.row())
        self.run_cli()
        with (self.state / "lock").open("rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_cli(expected=1)
        self.assertIn("busy", result.stderr)
        self.assertNotIn(str(self.state), result.stderr)
