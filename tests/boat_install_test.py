import shutil
import unittest

from boat_fixtures import BoatFixture


class InstallTests(BoatFixture):
    def setUp(self):
        super().setUp()
        self.executable("docker", 'echo docker >> "$FIXTURE_EVENTS"\nexit 1\n')

    def test_missing_curl_is_reported_before_build_or_download(self):
        for name in ("uname", "mktemp", "rm"):
            (self.bin / name).symlink_to(shutil.which(name))
        self.environment["PATH"] = str(self.bin)
        result = self.run_script("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("curl is missing", result.stderr)
        self.assertEqual(self.events.read_text(), "")

    def prepare_build(self, has_job):
        self.environment["FIXTURE_HAS_JOB"] = "yes" if has_job else "no"
        self.executable("docker", '''
echo build >> "$FIXTURE_EVENTS"
while [[ $1 != -v ]]; do shift; done
staging=${2%:/out}
mkdir -p "$staging/bin"
printf '#!/bin/bash\n[[ $1 == job && $2 == --help && $FIXTURE_HAS_JOB == yes ]]\n' > "$staging/bin/workspace"
chmod 755 "$staging/bin/workspace"
''')
        self.executable("curl", '''
echo download >> "$FIXTURE_EVENTS"
while [[ $1 != -o ]]; do shift; done
printf '#!/bin/bash\necho executed >> "$FIXTURE_EVENTS"\n' > "$2"
''')

    def test_workspace_without_job_fails_before_install_or_boat_download(self):
        self.prepare_build(False)
        result = self.run_script("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("workspace job", result.stderr)
        self.assertIn("PR8", result.stderr)
        self.assertEqual(self.events.read_text(), "build\n")
        self.assertFalse((self.home / ".local/bin").exists())

    def test_changed_boat_bytes_are_never_installed_or_executed(self):
        self.prepare_build(True)
        result = self.run_script("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SHA-256", result.stderr)
        self.assertNotIn("executed", self.events.read_text())
        self.assertFalse((self.home / ".local/bin").exists())


if __name__ == "__main__":
    unittest.main()
