import json

from support import ExportCase


class IncrementalTests(ExportCase):
    def test_repeated_scan_reads_no_old_bytes_and_keeps_identical_publication(self):
        self.append(self.row())
        self.run_cli()
        before = (self.output / "manifest.json").read_bytes()
        files = {path.name: path.read_bytes() for path in (self.output / "days").iterdir()}
        result = self.run_cli()
        self.assertEqual(json.loads(result.stdout)["read_bytes"], 0)
        self.assertEqual((self.output / "manifest.json").read_bytes(), before)
        self.assertEqual({path.name: path.read_bytes() for path in (self.output / "days").iterdir()}, files)

    def test_duplicate_rows_collapse_but_conflicting_ids_and_repeated_routes_survive(self):
        first = self.row(route_id=7)
        conflict = self.row(t="2026-11-17T23:30:00.123456790Z", route_id=7, out=21)
        self.append(first, first, conflict)
        self.run_cli()
        self.assertEqual(len(self.events()), 2)
        day = self.manifest()["days"][1]
        self.assertEqual(day["conflicting_id_events"], 2)
        self.assertEqual(self.manifest()["scan"]["duplicate_rows"], 1)
        self.run_cli("--rescan")
        self.assertEqual(self.manifest()["scan"]["duplicate_rows"], 1)
        self.assertEqual(len(self.events()), 2)

    def test_late_append_and_truncated_tail_recover_without_turning_missing_into_zero(self):
        self.append(self.row())
        self.run_cli()
        with self.ledger.open("ab") as stream:
            stream.write(json.dumps(self.row(t="2026-11-16T10:00:00Z")).encode())
        self.run_cli()
        self.assertEqual(self.manifest()["days"][0]["coverage"], "missing")
        self.assertGreater(self.manifest()["scan"]["deferred_tail_bytes"], 0)
        with self.ledger.open("ab") as stream:
            stream.write(b"\n")
        self.run_cli()
        day = self.manifest()["days"][0]
        self.assertEqual(day["coverage"], "partial")
        self.assertEqual(day["late_events"], 1)
        self.assertEqual(self.manifest()["days"][2]["workload"], None)

    def test_rotated_history_preserves_exported_events_and_identity(self):
        self.append(self.row())
        self.run_cli()
        host = self.manifest()["host_uuid"]
        self.ledger.rename(self.fixture / "retired.jsonl")
        self.ledger.write_text("")
        self.append(self.row(t="2026-11-18T08:00:00Z", response_id="next"))
        self.run_cli()
        self.assertEqual(self.manifest()["host_uuid"], host)
        self.assertEqual(len(self.events()), 2)
