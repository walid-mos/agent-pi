import json
import subprocess

from support import CLI, ExportCase

CANARY = "private-client-branch@example.invalid"


class ContractTests(ExportCase):
    def test_offset_instants_and_routing_overhead_keep_utc_and_report_days(self):
        self.append(self.row(t="2026-11-18T00:30:00.123456789+01:00"),
                    self.row(t="2026-11-18T01:30:00+01:00", kind="routing", response_id=""),
                    self.row(kind="model_list"))
        self.run_cli()
        first, overhead = self.events()
        self.assertEqual(first["ts_utc"], "2026-11-17T23:30:00.123456789Z")
        self.assertEqual(first["report_day"], "2026-11-18")
        self.assertEqual(overhead["kind"], "routing-overhead")
        self.assertEqual(self.manifest()["days"][2]["workload"]["events"], 0)
        self.assertEqual(self.manifest()["days"][2]["overhead"]["tokens"]["input"], 100)
        self.assertEqual(self.manifest()["scan"]["ignored_rows"], 1)

    def test_unknown_fields_and_identifying_values_never_leave_private_state(self):
        self.ledger = self.fixture / (CANARY + ".jsonl")
        self.ledger.write_text("")
        row = self.row(req=CANARY, model=CANARY, served=CANARY, provider=CANARY,
                       agent=CANARY, session=CANARY, providerAccount=CANARY,
                       response_id=CANARY, rid=CANARY, host=CANARY,
                       prompt=CANARY, reply=CANARY, toolargs=CANARY, worker=CANARY,
                       branch=CANARY, path=CANARY, callerKeyName=CANARY,
                       callerKeyId=CANARY, subagent=CANARY, tier_served=CANARY, upstream=CANARY)
        self.append(row)
        original = self.ledger.read_bytes()
        result = self.run_cli()
        for content in (result.stdout, result.stderr, json.dumps(self.manifest()), json.dumps(self.events())):
            self.assertNotIn(CANARY, content)
        self.assertNotIn(CANARY, " ".join(str(path.relative_to(self.output)) for path in self.output.rglob("*")))
        self.assertEqual(self.ledger.read_bytes(), original)
        self.assertEqual(self.state.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.state / "usage.sqlite").stat().st_mode & 0o777, 0o600)
        event = self.events()[0]
        self.assertIsNone(event["requested_model"]["label"])
        self.assertIsNone(event["worker_ref"])
        self.assertIsNone(event["project_ref"])
        self.assertNotEqual(event["requested_model"]["ref"], event["request_ref"])

    def test_absent_or_invalid_metrics_remain_unknown_and_missing_days_have_no_totals(self):
        self.append({"t": "2026-11-17T12:00:00Z", "in": -1, "out": True, "ms": "20"})
        self.run_cli()
        event = self.events()[0]
        self.assertIsNone(event["tokens"]["input"])
        self.assertIsNone(event["tokens"]["output"])
        self.assertIsNone(event["duration_ms"])
        self.assertIsNone(event["cost"]["estimate_usd"])
        self.assertIsNone(event["cost"]["billed_usd"])
        total = self.manifest()["days"][1]["workload"]
        self.assertEqual(total["unpriced_events"], 1)
        self.assertIsNone(total["estimate_usd"])
        self.assertIsNone(total["request_ms_sum"])
        self.assertIsNone(self.manifest()["days"][0]["workload"])

    def test_reviewed_catalog_exposes_only_selected_model_and_provider_labels(self):
        catalog = self.fixture / "catalog.json"
        catalog.write_text(json.dumps({"req": ["group/router"], "served": ["gpt-6.1-sol"], "provider": ["codex"]}))
        self.append(self.row())
        self.run_cli("--catalog", str(catalog))
        event = self.events()[0]
        self.assertEqual(event["requested_model"]["label"], "group/router")
        self.assertEqual(event["served_model"]["label"], "gpt-6.1-sol")
        self.assertEqual(event["provider"]["label"], "codex")
        self.assertIsNone(event["agent"]["label"])

    def test_schema_and_coverage_commands_expose_the_actual_contract(self):
        self.append(self.row())
        self.run_cli()
        schema = subprocess.run(["python3", "-B", str(CLI), "schema"], capture_output=True, text=True, check=True)
        coverage = subprocess.run(["python3", "-B", str(CLI), "coverage", "--output", str(self.output)],
                                  capture_output=True, text=True, check=True)
        self.assertIn("event", json.loads(schema.stdout)["$defs"])
        self.assertEqual(json.loads(coverage.stdout), self.manifest())

    def test_cross_day_identifier_conflicts_update_both_days(self):
        self.append(self.row())
        self.run_cli()
        self.append(self.row(t="2026-11-18T01:00:00Z"))
        self.run_cli()
        self.assertEqual(len(self.events()), 2)
        self.assertEqual(self.manifest()["days"][1]["conflicting_id_events"], 1)
        self.assertEqual(self.manifest()["days"][2]["conflicting_id_events"], 1)
