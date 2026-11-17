import json
import os
import signal

from host_support import HostCase
from support import CANARY

TOTALS = {"requests": 2, "input": 200, "output": 40, "cache_read": 20, "cache_write": 8,
          "cache_write_1h": 2, "reasoning": 10}


class HostRunTests(HostCase):
    def ledger_rows(self):
        return [self.row(t="2026-11-16T09:00:00Z", response_id="first"),
                self.row(t="2026-11-17T10:00:00Z", response_id="work"),
                self.row(t="2026-11-17T10:00:01Z", kind="routing", response_id=""),
                self.row(t="2026-11-18T08:00:00Z", response_id="today")]

    def test_exports_the_standard_paths_over_the_last_35_utc_days_in_paris_time(self):
        self.append(self.row())
        receipt = self.receipt()
        self.assertEqual(receipt["export"]["days"], 35)
        self.assertEqual(receipt["snapshot"], "magpie-missing")
        self.assertFalse(receipt["estimates_applied"])
        self.assertEqual(receipt["reconcile"], [])
        manifest = self.manifest()
        self.assertEqual((manifest["days"][0]["day"], manifest["days"][-1]["day"]), ("2026-10-15", "2026-11-18"))
        self.assertEqual(manifest["report_timezone"], "Europe/Paris")
        self.assertTrue((self.state / "usage.sqlite").is_file())
        self.assertIsNone(self.events()[0]["served_model"]["label"])

    def test_a_catalog_at_the_standard_path_labels_events(self):
        self.catalog.write_text(json.dumps({"served": ["gpt-6.1-sol"]}))
        self.append(self.row())
        self.run_host()
        self.assertEqual(self.events()[0]["served_model"]["label"], "gpt-6.1-sol")

    def test_a_magpie_snapshot_prices_events_and_leaves_no_snapshot_file(self):
        self.append(self.row())
        directory = self.install_magpie([self.row()])
        receipt = self.receipt()
        self.assertEqual((receipt["snapshot"], receipt["estimates_applied"]), ("taken", True))
        self.assertEqual((directory / "magpie.args").read_text(), "usage --csv all")
        self.assertEqual(self.events()[0]["cost"]["estimate_usd"], 0.25)
        self.assertEqual(list(self.temporary.iterdir()), [])

    def test_magpie_in_the_local_bin_folder_is_used_when_absent_from_path(self):
        self.append(self.row())
        self.install_magpie([self.row()], directory=self.home / ".local" / "bin")
        self.assertEqual(self.receipt()["snapshot"], "taken")

    def test_a_failing_magpie_exports_without_estimates_and_removes_its_partial_snapshot(self):
        self.append(self.row())
        self.install_magpie([self.row()], is_failing=True)
        receipt = self.receipt()
        self.assertEqual((receipt["snapshot"], receipt["estimates_applied"]), ("magpie-failed", False))
        self.assertIsNone(self.events()[0]["cost"]["estimate_usd"])
        self.assertEqual(list(self.temporary.iterdir()), [])

    def test_a_terminated_run_removes_its_snapshot(self):
        self.append(self.row())
        fifo = self.install_magpie([self.row()]) / "magpie.fifo"
        os.mkfifo(fifo)
        process = self.start_host()
        with fifo.open("w"):
            self.assertEqual(len(list(self.temporary.iterdir())), 1)
            process.terminate()
            process.wait(timeout=30)
        self.assertEqual(process.returncode, 128 + signal.SIGTERM)
        self.assertEqual(list(self.temporary.iterdir()), [])

    def test_a_failed_export_prints_its_receipt_and_removes_the_snapshot(self):
        self.append(self.row())
        self.install_magpie([self.row()])
        self.catalog.write_text(json.dumps({"unknown-field": ["x"]}))
        result = self.run_host(expected=1)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt, {"export": None, "snapshot": "taken", "estimates_applied": False,
                                   "reconcile": []})
        self.assertIn("export failed", result.stderr)
        self.assertEqual(list(self.temporary.iterdir()), [])

    def test_settled_closed_days_matching_the_snapshot_exit_zero(self):
        rows = self.ledger_rows()
        self.append(*rows, {"t": "2026-11-17T10:00:02Z", "kind": "model_list", "status": 0})
        self.install_magpie(rows)
        self.assertEqual(self.receipt()["reconcile"],
                         [{"day": "2026-11-17", "matches": True, "csv": TOTALS, "export": TOTALS}])

    def test_a_closed_day_with_a_row_missing_from_the_export_exits_non_zero(self):
        rows = self.ledger_rows()
        self.append(*rows)
        self.install_magpie([*rows, self.row(t="2026-11-17T11:00:00Z", response_id="lost")])
        entry, = self.receipt(expected=1)["reconcile"]
        self.assertEqual((entry["day"], entry["matches"]), ("2026-11-17", False))
        self.assertEqual((entry["csv"]["requests"], entry["export"]["requests"]), (3, 2))

    def test_a_closed_day_with_different_token_counts_exits_non_zero(self):
        rows = self.ledger_rows()
        self.append(*rows)
        self.install_magpie([rows[0], {**rows[1], "cache_write_1h": 7}, *rows[2:]])
        entry, = self.receipt(expected=1)["reconcile"]
        self.assertFalse(entry["matches"])
        self.assertEqual((entry["csv"]["cache_write_1h"], entry["export"]["cache_write_1h"]), (8, 2))
        self.assertEqual(entry["csv"]["requests"], entry["export"]["requests"])

    def test_a_day_closed_less_than_an_hour_before_the_snapshot_is_not_reconciled_yet(self):
        rows = self.ledger_rows()
        self.append(*rows)
        self.install_magpie([*rows, self.row(t="2026-11-17T23:59:00Z", response_id="in-flight")])
        self.assertEqual(self.receipt(now="2026-11-18T00:30:00Z")["reconcile"], [])

    def test_the_receipt_holds_no_raw_value_path_or_unlisted_label(self):
        row = self.row(t="2026-11-17T10:00:00Z", req=CANARY, model=CANARY, served=CANARY, provider=CANARY,
                       agent=CANARY, session=CANARY, providerAccount=CANARY, response_id=CANARY)
        first = self.row(t="2026-11-16T10:00:00Z", served=CANARY, response_id="first")
        self.append(first, row)
        self.install_magpie([first, row, {**row, "t": "2026-11-17T11:00:00Z"}])
        result = self.run_host(expected=1)
        self.assertNotIn(CANARY, result.stdout + result.stderr)
        self.assertNotIn(CANARY, self.published_text())
        self.catalog.write_text(json.dumps({"unknown-field": [CANARY]}))
        failed = self.run_host(expected=1)
        self.assertNotIn(CANARY, failed.stdout + failed.stderr)
