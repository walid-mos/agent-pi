import json
import subprocess

from support import CLI, ExportCase


class EdgeTests(ExportCase):
    def test_bad_rows_are_counted_and_later_rows_still_export(self):
        with self.ledger.open("ab") as stream:
            stream.write(b'{"prompt":"private-canary",broken}\n\xff\n')
            stream.write(b"x" * (1024 * 1024 + 10) + b"\n")
        self.append(self.row())
        self.run_cli()
        self.assertEqual(self.manifest()["scan"]["invalid_rows"], 3)
        self.assertEqual(len(self.events()), 1)

    def test_same_route_id_and_partial_response_ids_never_collapse_distinct_requests(self):
        self.append(self.row(route_id=8), self.row(route_id=8, t="2026-11-17T23:30:01Z"),
                    self.row(route_id=8, response_id="", rid="", t="2026-11-17T23:30:02Z"),
                    self.row(route_id=8, response_id="", rid="", t="2026-11-17T23:30:03Z"))
        self.run_cli()
        self.assertEqual(len(self.events()), 4)
        identifiers = {event["event_id"] for event in self.events()}
        self.assertEqual(len(identifiers), 4)

    def test_host_namespacing_and_rescan_keep_request_identity(self):
        self.append(self.row())
        self.run_cli()
        first = self.events()[0]
        self.run_cli("--rescan")
        self.assertEqual(self.events()[0]["event_id"], first["event_id"])
        self.state = self.fixture / "other-host-state"
        self.output = self.fixture / "other-host-export"
        self.run_cli()
        self.assertNotEqual(self.events()[0]["host_uuid"], first["host_uuid"])
        self.assertNotEqual(self.events()[0]["event_id"], first["event_id"])

    def test_state_refuses_source_or_timezone_rebinding_without_replacing_a_manifest(self):
        self.append(self.row())
        self.run_cli()
        original = (self.output / "manifest.json").read_bytes()
        self.run_cli("--timezone", "UTC", expected=1)
        self.assertEqual((self.output / "manifest.json").read_bytes(), original)

    def test_export_cannot_contain_its_private_state(self):
        self.state = self.output / "private"
        self.run_cli(expected=1)
        self.assertFalse(self.output.exists())

    def test_source_sidecars_cannot_be_overwritten_by_publication(self):
        self.output.mkdir()
        catalog = self.output / "manifest.json"
        catalog.write_text("{}")
        self.run_cli("--catalog", str(catalog), expected=1)
        self.assertEqual(catalog.read_text(), "{}")

    def test_schema_rejects_private_extra_fields_when_inspecting_coverage(self):
        self.run_cli()
        manifest = self.manifest()
        manifest["private_path"] = "private@example.invalid"
        (self.output / "manifest.json").write_text(json.dumps(manifest))
        result = subprocess.run(["python3", "-B", str(CLI), "coverage", "--output", str(self.output)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("private@example.invalid", result.stdout + result.stderr)
