import json
import subprocess

from boat_fixtures import BoatLimitsFixture, SCRIPTS


class BudgetTests(BoatLimitsFixture):
    def check_budget(self, ttl, *options):
        self.reply.write_text(json.dumps(self.limits))
        return subprocess.run(
            ["python3", "-B", str(SCRIPTS / "budget"), "small", ttl, *options],
            env=self.environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def decision(self, ttl, *options):
        result = self.check_budget(ttl, *options)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_bounds_ambiguous_rolling_units_and_reserves_fees_for_past_and_new_starts(self):
        decision = self.decision("2000s")
        self.assertEqual(decision, {
            "decision": "fits",
            "rollingComputeBoundDollars": "0.0685",
            "rollingStartFeeBoundDollars": "0.28",
            "remainderDollars": "1.6515",
            "maximumChargeDollars": "0.08",
        })
        self.assertEqual(self.events.read_text(), "--no-update limits --all --json\n")

    def test_defers_when_two_simultaneous_starts_could_exceed_remainder(self):
        self.assertEqual(self.decision("158000s")["decision"], "contended")

    def test_an_exclusive_check_can_use_the_entire_remainder(self):
        self.assertEqual(self.decision("316300s", "--serialized")["decision"], "fits")

    def test_asks_only_when_one_start_exceeds_remainder(self):
        self.assertEqual(self.decision("316300s")["decision"], "contended")
        self.assertEqual(self.decision("316301s")["decision"], "over-budget")

    def test_defers_when_another_environment_has_an_active_sandbox(self):
        self.limits.update(activeSandboxes=1)
        self.assertEqual(self.decision("2000s")["decision"], "busy")

    def test_refuses_a_blocked_provider_start(self):
        self.limits.update(canStart=False, nextStartDollars=None)
        self.assertEqual(self.decision("2000s")["decision"], "provider-blocked")

    def test_missing_fee_coverage_fails_closed(self):
        del self.limits["starts"]["day"]
        result = self.check_budget("2000s")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("starts.day.used", result.stderr)
