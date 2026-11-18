import json
import unittest

from boat_fixtures import BoatFixture


class AccessTests(BoatFixture):
    def setUp(self):
        super().setUp()
        sandbox = self.home / ".config/agent-sandbox/sandboxes/fixture-pot"
        sandbox.mkdir(parents=True)
        (sandbox / "vault.json").write_text(json.dumps({"project": "fixture", "environment": "dev"}))
        (sandbox / "sandbox.json").write_text("{}")
        infisical = self.home / ".pi/agent/bin/infisical"
        infisical.parent.mkdir(parents=True)
        infisical.write_text('#!/bin/bash\nprintf \'[{"folderName":"boat"},{"folderName":"fixture-pot"}]\'\n')
        infisical.chmod(0o755)
        self.executable("workspace", "exit 0\n")
        self.executable("boat", '''
shift
case "$1 $2" in
'env info') printf '{"environment":{"id":"fixture-environment"}}' ;;
'api-key list') printf '{"apiKeys":[{"name":"pots-fixture-pot","id":"old-key"}]}' ;;
'api-key create') printf '{"id":"new-key","secret":"fixture-control-value"}' ;;
'api-key revoke')
    echo "revoke $3" >> "$FIXTURE_EVENTS"
    [[ ${FIXTURE_REVOKE_FAILURE:-} != "$3" ]]
    ;;
*) exit 1 ;;
esac
''')
        self.executable("node", '''
while [[ $1 != --name ]]; do shift; done
name=$2
value=$(</dev/stdin)
if [[ ${FIXTURE_STORE_FAILURE:-} == "$name" ]]; then
    [[ ${FIXTURE_COMMITTED_FAILURE:-no} != yes ]] || echo "stored $name" >> "$FIXTURE_EVENTS"
    exit 1
fi
echo "stored $name" >> "$FIXTURE_EVENTS"
''')

    def test_second_store_failure_revokes_old_keys_but_keeps_stored_new_key(self):
        self.environment["FIXTURE_STORE_FAILURE"] = "BOAT_ENVIRONMENT"
        result = self.run_script("pot-access", "fixture-pot")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events.read_text(), "stored BOAT_API_KEY\nrevoke old-key\n")
        self.assertIn("new key new-key was retained", result.stderr)
        self.assertIn("may have committed", result.stderr)
        self.assert_no_fixture_secret(result)

    def test_second_store_failure_after_commit_has_the_same_safe_cleanup(self):
        self.environment.update(FIXTURE_STORE_FAILURE="BOAT_ENVIRONMENT", FIXTURE_COMMITTED_FAILURE="yes")
        result = self.run_script("pot-access", "fixture-pot")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events.read_text(), "stored BOAT_API_KEY\nstored BOAT_ENVIRONMENT\nrevoke old-key\n")
        self.assertIn("may have committed", result.stderr)
        self.assert_no_fixture_secret(result)

    def test_first_store_failure_revokes_new_key_and_keeps_old_key(self):
        self.environment["FIXTURE_STORE_FAILURE"] = "BOAT_API_KEY"
        result = self.run_script("pot-access", "fixture-pot")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events.read_text(), "revoke new-key\n")
        self.assertIn("previous keys still work", result.stderr)
        self.assert_no_fixture_secret(result)

    def test_successful_rotation_revokes_old_key_after_both_stores(self):
        result = self.run_script("pot-access", "fixture-pot")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.events.read_text(), "stored BOAT_API_KEY\nstored BOAT_ENVIRONMENT\nrevoke old-key\n")
        self.assert_no_fixture_secret(result)

    def test_failed_old_key_revocation_reports_cleanup_without_revoking_new_key(self):
        self.environment.update(FIXTURE_STORE_FAILURE="BOAT_ENVIRONMENT", FIXTURE_REVOKE_FAILURE="old-key")
        result = self.run_script("pot-access", "fixture-pot")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.events.read_text(), "stored BOAT_API_KEY\nrevoke old-key\n")
        self.assertIn("could not revoke previous key old-key", result.stderr)
        self.assertIn("new key new-key was retained", result.stderr)
        self.assertIn("BOAT_ENVIRONMENT", result.stderr)
        self.assert_no_fixture_secret(result)


if __name__ == "__main__":
    unittest.main()
