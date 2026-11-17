import json
import sqlite3

from host_support import HostCase
from support import ExportCase

OLD_BINDING = json.dumps("0" * 64)


def write_old_binding(state):
    with sqlite3.connect(state / "usage.sqlite") as database:
        database.execute("UPDATE metadata SET value=? WHERE key='binding'", (OLD_BINDING,))


def read_binding(state):
    with sqlite3.connect(state / "usage.sqlite") as database:
        return database.execute("SELECT value FROM metadata WHERE key='binding'").fetchone()[0]


class OldStateTests(ExportCase):
    def test_old_catalog_binding_names_the_state_and_older_version_without_migrating(self):
        self.append(self.row())
        self.run_cli()
        before = (self.output / "manifest.json").read_bytes()
        write_old_binding(self.state)
        result = self.run_cli(expected=1)
        self.assertIn(str(self.state / "usage.sqlite"), result.stderr)
        self.assertIn("written by an older version", result.stderr)
        self.assertIn("new state directory", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(read_binding(self.state), OLD_BINDING)
        self.assertEqual((self.output / "manifest.json").read_bytes(), before)


class HostOldStateTests(HostCase):
    def test_host_preserves_old_state_and_reports_its_path_and_older_version(self):
        self.append(self.row())
        self.run_host()
        before = self.published()
        write_old_binding(self.state)
        result = self.run_host(expected=1)
        self.assertIn(str(self.state / "usage.sqlite"), result.stderr)
        self.assertIn("written by an older version", result.stderr)
        self.assertIn("new state directory", result.stderr)
        self.assertIsNone(json.loads(result.stdout)["export"])
        self.assertEqual(read_binding(self.state), OLD_BINDING)
        self.assertEqual(self.published(), before)
