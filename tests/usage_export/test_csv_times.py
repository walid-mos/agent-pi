from itertools import product

from support import CANARY, ExportCase
from test_estimates import VALUES


class CsvTimeTests(ExportCase):
    def test_offsetless_time_refuses_the_snapshot_with_a_column_and_shape_diagnostic(self):
        values = ("2026-11-17T23:30:00", "2026-11-17 23:30:00.123456789")
        for index, (value, cost, tokens) in enumerate(product(values, ("0.25", "bad-cost"), (100, "bad-token"))):
            with self.subTest(time=value, cost=cost, tokens=tokens):
                self.state = self.fixture / f"state-{index}"
                self.output = self.fixture / f"export-{index}"
                self.ledger.write_text("")
                self.append(self.row())
                self.run_cli()
                before = (self.output / "manifest.json").read_bytes()
                invalid = [value, *VALUES[1:]]
                invalid[4], invalid[-1] = tokens, cost
                snapshot = self.estimates([VALUES, invalid])
                result = self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z", expected=1)
                self.assertIn("CSV column time", result.stderr)
                self.assertIn("YYYY-MM-DD[T or space]HH:MM:SS[.fraction]", result.stderr)
                self.assertIn("Z or a numeric offset", result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertEqual((self.output / "manifest.json").read_bytes(), before)
                self.assertIsNone(self.events()[0]["cost"]["estimate_usd"])

    def test_z_and_numeric_offsets_accept_fractional_seconds_bom_and_both_separators(self):
        values = ("2026-11-17T23:30:00Z", "2026-11-17 23:30:00.5Z",
                  "2026-11-18T01:30:00+02:00", "2026-11-17 18:00:00.123456789-05:30")
        self.append(self.row())
        for index, value in enumerate(values):
            with self.subTest(time=value):
                self.state = self.fixture / f"state-{index}"
                self.output = self.fixture / f"export-{index}"
                snapshot = self.estimates([[value, *VALUES[1:]]], encoding="utf-8-sig")
                self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
                self.assertEqual(self.events()[0]["cost"]["estimate_usd"], 0.25)

    def test_unparseable_time_stays_unknown_without_echoing_the_cell(self):
        self.append(self.row())
        snapshot = self.estimates([[CANARY, *VALUES[1:]]])
        result = self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
        self.assertNotIn(CANARY, result.stdout + result.stderr)
        self.assertIsNone(self.events()[0]["cost"]["estimate_usd"])
