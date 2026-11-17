import json

from support import ExportCase


class CatalogGrowthTests(ExportCase):
    def write_catalog(self, labels):
        catalog = self.fixture / "catalog.json"
        catalog.write_text(json.dumps(labels))
        return catalog

    def export(self, labels=None, *extra, expected=0):
        options = ["--catalog", str(self.write_catalog(labels))] if labels is not None else []
        return self.run_cli(*options, *extra, expected=expected)

    def day_hashes(self):
        return {entry["day"]: entry["sha256"] for entry in self.manifest()["days"]}

    def test_new_labels_relabel_stored_events_and_republish_only_their_days(self):
        self.append(self.row(), self.row(t="2026-11-18T08:00:00Z", served="claude-opus-5-5", response_id="b"))
        self.export({"req": ["group/router"]})
        identifiers = sorted(event["event_id"] for event in self.events())
        before = self.day_hashes()
        receipt = json.loads(self.export({"req": ["group/router"], "served": ["gpt-6.1-sol"]}).stdout)
        self.assertEqual(receipt["relabelled_events"], 1)
        self.assertEqual(sorted(event["event_id"] for event in self.events()), identifiers)
        labels = {event["ts_utc"][:10]: event["served_model"]["label"] for event in self.events()}
        self.assertEqual(labels, {"2026-11-17": "gpt-6.1-sol", "2026-11-18": None})
        after = self.day_hashes()
        self.assertNotEqual(after["2026-11-17"], before["2026-11-17"])
        self.assertEqual(after["2026-11-18"], before["2026-11-18"])

    def test_an_event_relabelled_in_several_fields_is_counted_once(self):
        self.append(self.row())
        self.export()
        receipt = json.loads(self.export({"req": ["group/router"], "served": ["gpt-6.1-sol"],
                                          "provider": ["codex"], "agent": ["pi"]}).stdout)
        self.assertEqual(receipt["relabelled_events"], 1)
        event, = self.events()
        self.assertEqual([event[field]["label"] for field in
                          ("requested_model", "served_model", "provider", "agent")],
                         ["group/router", "gpt-6.1-sol", "codex", "pi"])

    def test_a_catalog_that_drops_or_changes_a_bound_label_is_refused(self):
        self.append(self.row())
        self.export({"served": ["gpt-6.1-sol"]})
        published = (self.output / "manifest.json").read_bytes()
        self.export({"served": ["claude-opus-5-5"]}, expected=1)
        self.export(expected=1)
        self.assertEqual((self.output / "manifest.json").read_bytes(), published)
        receipt = json.loads(self.export({"served": ["gpt-6.1-sol"]}).stdout)
        self.assertEqual(receipt["relabelled_events"], 0)

    def test_a_state_bound_without_a_catalog_accepts_its_first_catalog(self):
        self.append(self.row())
        self.export()
        receipt = json.loads(self.export({"served": ["gpt-6.1-sol"]}).stdout)
        self.assertEqual(receipt["relabelled_events"], 1)
        self.assertEqual(self.events()[0]["served_model"]["label"], "gpt-6.1-sol")

    def test_a_catalog_extension_cannot_carry_a_timezone_change(self):
        self.append(self.row())
        self.export({"req": ["group/router"]})
        self.export({"req": ["group/router"], "served": ["gpt-6.1-sol"]}, "--timezone", "UTC", expected=1)
        self.assertIsNone(self.events()[0]["served_model"]["label"])
        self.assertEqual(self.manifest()["report_timezone"], "Europe/Paris")

    def test_relabelling_reaches_every_stored_event_beyond_one_batch(self):
        rows = [self.row(t=f"2026-11-17T10:{index // 60:02d}:{index % 60:02d}Z", response_id=f"r{index}")
                for index in range(1001)]
        self.append(*rows)
        self.export()
        receipt = json.loads(self.export({"served": ["gpt-6.1-sol"]}).stdout)
        self.assertEqual(receipt["relabelled_events"], 1001)
        self.assertEqual({event["served_model"]["label"] for event in self.events()}, {"gpt-6.1-sol"})
