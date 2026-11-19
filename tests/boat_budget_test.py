import json
from pathlib import Path
import subprocess

from boat_fixtures import BoatFixture, SCRIPTS

LIMITS = Path(__file__).parent / "fixtures/boat-limits-idle.json"


class BudgetTests(BoatFixture):
    def setUp(self):
        super().setUp()
        self.limits = json.loads(LIMITS.read_text())
        self.reply = self.root / "limits.json"
        self.environment["FIXTURE_LIMITS"] = str(self.reply)
        self.executable("boat", '''
[[ $* == "--no-update limits --all --json" ]] || exit 3
printf '%s\n' "$*" >> "$FIXTURE_EVENTS"
cat "$FIXTURE_LIMITS"
''')

    def check_budget(self, maximum, *options):
        self.reply.write_text(json.dumps(self.limits))
        return subprocess.run(
            ["python3", "-B", str(SCRIPTS / "budget"), maximum, "--highest-hourly-dollars", "0.200", *options],
            env=self.environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def decision(self, maximum, *options):
        result = self.check_budget(maximum, *options)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_bounds_ambiguous_rolling_units_and_reserves_fees_for_past_and_new_starts(self):
        decision = self.decision("0.01")
        self.assertEqual(decision, {
            "decision": "fits",
            "rollingComputeBoundDollars": "0.0685",
            "rollingStartFeeBoundDollars": "0.28",
            "remainderDollars": "1.6515",
            "maximumChargeDollars": "0.08",
        })
        self.assertEqual(self.events.read_text(), "--no-update limits --all --json\n")

    def test_defers_when_two_simultaneous_starts_could_exceed_remainder(self):
        self.assertEqual(self.decision("0.79")["decision"], "contended")

    def test_an_exclusive_check_can_use_the_entire_remainder(self):
        self.assertEqual(self.decision("1.5815", "--serialized")["decision"], "fits")

    def test_asks_only_when_one_start_exceeds_remainder(self):
        self.assertEqual(self.decision("1.5815")["decision"], "contended")
        self.assertEqual(self.decision("1.581501")["decision"], "over-budget")

    def test_defers_when_another_environment_has_an_active_sandbox(self):
        self.limits.update(activeSandboxes=1)
        self.assertEqual(self.decision("0.01")["decision"], "busy")

    def test_refuses_a_blocked_provider_start(self):
        self.limits.update(canStart=False, nextStartDollars=None)
        self.assertEqual(self.decision("0.01")["decision"], "provider-blocked")

    def test_missing_fee_coverage_fails_closed(self):
        del self.limits["starts"]["day"]
        result = self.check_budget("0.01")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("starts.day.used", result.stderr)
