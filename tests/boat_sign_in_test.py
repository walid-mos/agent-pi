import unittest

from boat_fixtures import BoatFixture


class SignInTests(BoatFixture):
    def setUp(self):
        super().setUp()
        self.environment.update(BOAT_API_KEY="fixture-control-value", BOAT_ENVIRONMENT="pots-fixture-pot")
        self.config = self.home / ".config/workspace/config.toml"
        self.config.parent.mkdir(parents=True)
        self.executable("boat", 'printf \'{"account":{"signedIn":true}}\'\n')
        self.executable("workspace", 'echo setup >> "$FIXTURE_EVENTS"\n')

    def test_environment_in_an_unrelated_table_does_not_authorize_setup(self):
        self.config.write_text('provider = "boat"\n[profiles.pi]\nenvironment = "pots-fixture-pot"\n[providers.boat]\nenvironment = "stale"\n')
        result = self.run_script("sign-in")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("[providers.boat]", result.stderr)
        self.assertEqual(self.events.read_text(), "")
        self.assert_no_fixture_secret(result)

    def test_actual_boat_table_accepts_valid_toml_formatting(self):
        self.config.write_text("provider='boat'\n[providers.boat]\nenvironment='pots-fixture-pot' # selected environment\n")
        before = self.config.read_bytes()
        result = self.run_script("sign-in")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events.read_text(), "setup\n")
        self.assertEqual(self.config.read_bytes(), before)
        self.assert_no_fixture_secret(result)

    def test_missing_config_is_created_for_the_expected_environment(self):
        result = self.run_script("sign-in")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('[providers.boat]\nenvironment = "pots-fixture-pot"', self.config.read_text())
        self.assertEqual(self.events.read_text(), "setup\n")
        self.assert_no_fixture_secret(result)

    def test_invalid_toml_is_refused_without_setup(self):
        self.config.write_text('environment = "pots-fixture-pot"\n[providers.boat\n')
        result = self.run_script("sign-in")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events.read_text(), "")
        self.assert_no_fixture_secret(result)

    def test_missing_supported_parser_is_reported(self):
        self.executable("python3", "exit 1\n")
        result = self.run_script("sign-in")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Python 3.11+", result.stderr)
        self.assertEqual(self.events.read_text(), "")
        self.assert_no_fixture_secret(result)


if __name__ == "__main__":
    unittest.main()
