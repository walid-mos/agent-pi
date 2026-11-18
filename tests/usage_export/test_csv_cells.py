import json
from itertools import product

from support import CLI, ESTIMATE_HEADERS, ExportCase
from test_estimates import VALUES

NUMERIC_COLUMNS = {"in": "input_tokens", "out": "output_tokens", "cache_read": "cache_read_tokens",
                   "cache_write": "cache_write_tokens", "cache_write_1h": "cache_write_1h_tokens",
                   "reasoning": "reasoning_tokens", "ms": "duration_ms", "status": "status"}


class CsvCellTests(ExportCase):
    def test_unreadable_numeric_cell_leaves_only_its_row_unpriced_and_coverage_reports_it(self):
        cases = product(NUMERIC_COLUMNS.items(), ("not-a-number", "", " ", "NaN", "inf", "-1"), (100, None))
        for index, ((field, column), value, ledger_value) in enumerate(cases):
            with self.subTest(column=column, value=value, ledger_value=ledger_value):
                self.ledger.write_text("")
                self.state = self.fixture / f"state-{index}"
                self.output = self.fixture / f"export-{index}"
                self.append(self.row(), self.row(response_id="bad", **{field: ledger_value}),
                            self.row(response_id="last"))
                invalid = [*VALUES]
                invalid[ESTIMATE_HEADERS.index(column)] = value
                invalid[12] = "bad"
                last = [*VALUES[:12], "last", *VALUES[13:-1], "0.75"]
                snapshot = self.estimates([VALUES, invalid, last])
                result = self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
                self.assertEqual(result.stderr, "")
                self.assertEqual(len(self.events()), 3)
                self.assertEqual(sorted(event["cost"]["estimate_usd"] for event in self.events()
                                        if event["cost"]["estimate_usd"] is not None), [0.25, 0.75])
                unknown = [event for event in self.events() if event["cost"]["estimate_usd"] is None]
                self.assertEqual(len(unknown), 1)
                self.assertEqual(unknown[0]["cost"]["price_source"], "unavailable")
                coverage = self.invoke(["python3", "-B", str(CLI), "coverage", "--output", str(self.output)])
                self.assertEqual(coverage.returncode, 0, coverage.stderr)
                total = json.loads(coverage.stdout)["days"][1]["workload"]
                self.assertEqual((total["events"], total["unpriced_events"], total["estimate_usd"]), (3, 1, 1.0))
