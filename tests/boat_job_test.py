import json
import subprocess

from boat_fixtures import BoatLimitsFixture, SCRIPTS


class JobTests(BoatLimitsFixture):
    def setUp(self):
        super().setUp()
        self.executable("uname", 'printf "Darwin\\n"')
        self.executable("workspace", '''
if [[ $* == list ]]; then exit 0; fi
printf '%s\n' "$@" >> "$FIXTURE_EVENTS"
''')

    def launch(self, size, ttl, *options):
        self.reply.write_text(json.dumps(self.limits))
        return subprocess.run(
            [str(SCRIPTS / "job"), "fixture-run", "--provider", "boat", "--boat-type", size,
             "--boat-ttl", ttl, "--command", "printf ready", *options],
            env=self.environment, text=True, capture_output=True, check=False,
        )

    def assert_refused(self, result, reason):
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertIn(reason, result.stderr)
        self.assertNotIn("job", self.events.read_text().splitlines())

    def test_over_budget_launch_never_reaches_workspace_job(self):
        self.assert_refused(self.launch("xlarge", "9h"), "over-budget")

    def test_launch_prices_and_forwards_the_same_size_and_ttl(self):
        result = self.launch("default", "9h")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"maximumChargeDollars": "0.394"', result.stderr)
        self.assertEqual(self.events.read_text().splitlines(), [
            "--no-update limits --all --json", "job", "fixture-run", "--provider=boat", "--boat-type=default",
            "--boat-ttl=9h", "--command=printf ready",
        ])

    def test_missing_usage_refuses_even_an_explicit_exception(self):
        del self.limits["last24hUsageSeconds"]
        self.assert_refused(self.launch("xlarge", "9h", "--approved-max-dollars", "1.87"), "last24hUsageSeconds")

    def test_missing_account_concurrency_refuses_launch(self):
        del self.limits["activeSandboxes"]
        self.assert_refused(self.launch("small", "120s"), "activeSandboxes")

    def test_exception_cannot_exceed_approved_maximum(self):
        self.assert_refused(self.launch("xlarge", "9h", "--approved-max-dollars", "1.86"), "1.87")

    def test_exception_releases_a_single_over_budget_launch(self):
        result = self.launch("xlarge", "9h", "--approved-max-dollars", "1.87")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("job", self.events.read_text().splitlines())
        self.assertNotIn("approved-max-dollars", self.events.read_text())

    def test_control_key_never_reaches_workspace_job(self):
        self.assert_refused(self.launch("small", "120s", "--env=BOAT_API_KEY"), "control key")
