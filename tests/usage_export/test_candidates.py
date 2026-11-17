import json

from host_support import HostCase
from support import CANARY


class CandidateTests(HostCase):
    def test_lists_unlabelled_raw_values_with_their_event_counts(self):
        self.catalog.write_text(json.dumps({"served": ["gpt-6.1-sol"], "provider": ["codex"]}))
        self.append(self.row(), self.row(t="2026-11-17T10:00:00Z", response_id="b"),
                    self.row(t="2026-11-17T11:00:00Z", served="claude-opus-5-5", response_id="c"))
        self.run_host()
        self.assertEqual(self.receipt("candidates"), {
            "agent": [{"value": "pi", "events": 3}], "provider": [],
            "req": [{"value": "group/router", "events": 3}],
            "served": [{"value": "claude-opus-5-5", "events": 1}]})

    def test_never_writes_raw_values_into_the_published_folder(self):
        self.append(self.row(req=CANARY, served=CANARY, provider=CANARY, agent=CANARY))
        self.run_host()
        published = self.published()
        result = self.run_host("candidates")
        self.assertIn(CANARY, result.stdout)
        self.assertEqual(self.published(), published)
        self.assertNotIn(CANARY, self.published_text())

    def test_fails_without_creating_a_state_before_the_first_export(self):
        result = self.run_host("candidates", expected=1)
        self.assertIn("no export state", result.stderr)
        self.assertNotIn(CANARY, result.stderr)
        self.assertFalse(self.state.exists())
