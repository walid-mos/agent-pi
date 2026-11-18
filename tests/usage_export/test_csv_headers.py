import csv

from host_support import HostCase
from support import CANARY, ESTIMATE_HEADERS, ExportCase
from test_estimates import VALUES

HEADER_CASES = (
    ("missing", ESTIMATE_HEADERS[:4] + ESTIMATE_HEADERS[5:], VALUES[:4] + VALUES[5:], ("input_tokens",)),
    ("renamed", [*ESTIMATE_HEADERS[:4], CANARY, *ESTIMATE_HEADERS[5:]], VALUES, ("input_tokens",)),
    ("reordered", [*ESTIMATE_HEADERS[:4], "output_tokens", "input_tokens", *ESTIMATE_HEADERS[6:]],
     [*VALUES[:4], VALUES[5], VALUES[4], *VALUES[6:]], ("input_tokens", "output_tokens")),
    ("extra", [*ESTIMATE_HEADERS, CANARY], [*VALUES, CANARY], ("extra columns",)),
    ("duplicate", [*ESTIMATE_HEADERS[:5], "input_tokens", *ESTIMATE_HEADERS[6:]], VALUES, ("output_tokens",)),
    ("empty", [], None, ("time", "cost_usd")),
)


def write_snapshot(path, headers, row):
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(headers)
        if row is not None:
            writer.writerow(row)


class CsvHeaderTests(ExportCase):
    def test_missing_renamed_reordered_extra_duplicate_and_empty_headers_name_differing_columns(self):
        self.append(self.row())
        self.run_cli()
        before = (self.output / "manifest.json").read_bytes()
        for name, headers, row, expected in HEADER_CASES:
            with self.subTest(header=name):
                snapshot = self.fixture / "estimates.csv"
                write_snapshot(snapshot, headers, row)
                result = self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z", expected=1)
                self.assertIn("CSV header differs", result.stderr)
                self.assertTrue(all(column in result.stderr for column in expected), result.stderr)
                self.assertNotIn(CANARY, result.stdout + result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertEqual((self.output / "manifest.json").read_bytes(), before)


class HostCsvHeaderTests(HostCase):
    def test_successful_magpie_with_an_unexpected_header_refuses_loudly_and_removes_snapshot(self):
        self.append(self.row())
        directory = self.install_magpie([self.row()])
        for name, headers, row, expected in HEADER_CASES:
            with self.subTest(header=name):
                write_snapshot(directory / "magpie.csv", headers, row)
                result = self.run_host(expected=1)
                self.assertIn("CSV header differs", result.stderr)
                self.assertTrue(all(column in result.stderr for column in expected), result.stderr)
                self.assertNotIn(CANARY, result.stdout + result.stderr)
                self.assertEqual(list(self.temporary.iterdir()), [])
                self.assertFalse((self.output / "manifest.json").exists())
