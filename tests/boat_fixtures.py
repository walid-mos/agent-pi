import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import uuid


SCRIPTS = Path(__file__).resolve().parents[1] / "skills/boat/scripts"


class BoatFixture(unittest.TestCase):
    def setUp(self):
        self.run_id = str(uuid.uuid4())
        self.root = Path(tempfile.mkdtemp(prefix="boat-fixture-"))
        self.record = Path(tempfile.gettempdir()) / f"boat-fixture-{self.run_id}.json"
        self.addCleanup(self.remove_fixture)
        self.record.write_text(json.dumps({"path": str(self.root), "owner": self.run_id}))
        (self.root / ".owner").write_text(self.run_id)
        self.home = self.root / "home"
        self.bin = self.root / "bin"
        self.home.mkdir()
        self.bin.mkdir()
        self.events = self.root / "events"
        self.events.touch()
        self.environment = {
            "HOME": str(self.home),
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "FIXTURE_EVENTS": str(self.events),
        }

    def remove_fixture(self):
        recorded = json.loads(self.record.read_text())
        self.assertEqual(recorded, {"path": str(self.root), "owner": self.run_id})
        self.assertEqual((self.root / ".owner").read_text(), self.run_id)
        shutil.rmtree(self.root)
        self.record.unlink()

    def executable(self, name, body):
        target = self.bin / name
        target.write_text("#!/bin/bash\nset -eu\n" + body)
        target.chmod(0o755)

    def run_script(self, name, *arguments):
        return subprocess.run(
            ["/bin/bash", str(SCRIPTS / name), *arguments],
            env=self.environment,
            text=True,
            capture_output=True,
            check=False,
        )

    def assert_no_fixture_secret(self, result):
        self.assertNotIn("fixture-control-value", result.stdout + result.stderr)


class BoatLimitsFixture(BoatFixture):
    def setUp(self):
        super().setUp()
        fixture = Path(__file__).parent / "fixtures/boat-limits-idle.json"
        self.limits = json.loads(fixture.read_text())
        self.reply = self.root / "limits.json"
        self.environment["FIXTURE_LIMITS"] = str(self.reply)
        self.executable("boat", '''
[[ $* == "--no-update limits --all --json" ]] || exit 3
printf '%s\\n' "$*" >> "$FIXTURE_EVENTS"
cat "$FIXTURE_LIMITS"
''')
        self.executable("curl", r'''
[[ ${!#} == https://docs.boat.dev/pricing.md ]] || exit 3
printf '%s\n' '| Size | Per hour | CPU | RAM | Disk |' \
    '| - | - | - | - | - |' \
    '| `small` | **\$0.018** | 2 vCPU | 4 GB | 51 GB |' \
    '| `default` | **\$0.036** | 4 vCPU | 8 GB | 51 GB |' \
    '| `large` | **\$0.072** | 8 vCPU | 16 GB | 111 GB |' \
    '| `xlarge` \* | **\$0.200** | 16 vCPU | 32 GB | 251 GB |'
''')
