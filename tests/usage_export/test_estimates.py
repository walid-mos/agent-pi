import json

from support import ExportCase

VALUES = ["2026-11-17T23:30:00Z", "group/router", "codex", "gpt-6.1-sol", 100, 20, 10, 4, 1, 5,
          250, 200, "response-a", "", "", "0.25"]


class EstimateTests(ExportCase):
    def test_invalid_cost_rows_stay_unknown_without_discarding_valid_neighbors(self):
        self.append(self.row(), self.row(response_id="bad"), self.row(response_id="last"))
        invalid_costs = ["not-a-cost", " ", "NaN", "inf", "-inf", "1e309", "-1", "9007199254740992"]
        for index, amount in enumerate(invalid_costs):
            with self.subTest(cost=amount):
                self.state = self.fixture / f"state-{index}"
                self.output = self.fixture / f"export-{index}"
                invalid = [*VALUES[:12], "bad", *VALUES[13:-1], amount]
                last = [*VALUES[:12], "last", *VALUES[13:-1], "0.75"]
                snapshot = self.estimates([VALUES, invalid, last])
                self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
                events = self.events()
                self.assertEqual(sorted(event["cost"]["estimate_usd"] for event in events
                                        if event["cost"]["estimate_usd"] is not None), [0.25, 0.75])
                unknown = [event for event in events if event["cost"]["estimate_usd"] is None]
                self.assertEqual(len(unknown), 1)
                self.assertEqual(unknown[0]["cost"]["price_source"], "unavailable")
                total = self.manifest()["days"][1]["workload"]
                self.assertEqual(total["events"], 3)
                self.assertEqual(total["unpriced_events"], 1)
                self.assertEqual(total["estimate_usd"], 1.0)

    def test_available_estimate_has_snapshot_provenance_and_never_becomes_billed_cost(self):
        self.append(self.row(), self.row(kind="routing", response_id="routing"))
        snapshot = self.estimates([VALUES])
        self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
        events = self.events()
        priced = next(event for event in events if event["kind"] == "workload")
        self.assertEqual(priced["cost"]["estimate_usd"], 0.25)
        self.assertEqual(priced["cost"]["price_source"], "magpie-csv-snapshot")
        self.assertEqual(priced["cost"]["price_snapshot_at"], "2026-11-18T10:00:00.000000000Z")
        self.assertIsNone(priced["cost"]["billed_usd"])
        self.assertEqual(self.manifest()["days"][1]["overhead"]["unpriced_events"], 1)
        self.estimates([[*VALUES[:-1], "500"]])
        self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-19T10:00:00Z")
        self.assertEqual(next(event for event in self.events() if event["kind"] == "workload")["cost"]["estimate_usd"], 0.25)

    def test_ambiguous_snapshot_matches_are_unpriced(self):
        self.append(self.row(), self.row(t="2026-11-17T23:30:00.987654321Z"))
        snapshot = self.estimates([VALUES, VALUES])
        self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
        self.assertEqual(self.manifest()["days"][1]["workload"]["unpriced_events"], 2)

    def test_new_collision_revokes_an_estimate_that_can_no_longer_be_joined(self):
        self.append(self.row())
        snapshot = self.estimates([VALUES])
        self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
        self.append(self.row(t="2026-11-17T23:30:00.987654321Z"))
        self.run_cli()
        self.assertEqual(self.manifest()["days"][1]["workload"]["unpriced_events"], 2)
        self.assertIsNone(self.manifest()["days"][1]["workload"]["estimate_usd"])

    def test_unavailable_estimates_can_be_filled_later_with_event_ids_unchanged(self):
        self.append(self.row())
        self.run_cli()
        identifier = self.events()[0]["event_id"]
        snapshot = self.estimates([VALUES])
        self.run_cli("--estimates", str(snapshot), "--price-snapshot-at", "2026-11-18T10:00:00Z")
        self.assertEqual(self.events()[0]["event_id"], identifier)
        self.assertEqual(self.events()[0]["cost"]["estimate_usd"], 0.25)
