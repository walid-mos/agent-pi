import json
import sys

from support import ROOT, ExportCase

sys.path.insert(0, str(ROOT / "bin" / "lib"))
from usage_export.storage import MAX_LINE_BYTES


class LineLimitTests(ExportCase):
    def payload(self, size):
        encoded = json.dumps(self.row(padding="")).encode()
        return json.dumps(self.row(padding="x" * (size - len(encoded)))).encode()

    def test_exact_limit_payload_waits_for_newline_then_exports(self):
        self.ledger.write_bytes(self.payload(MAX_LINE_BYTES))
        self.run_cli()
        self.assertEqual(self.events(), [])
        self.assertEqual(self.manifest()["scan"]["invalid_rows"], 0)
        self.assertEqual(self.manifest()["scan"]["deferred_tail_bytes"], MAX_LINE_BYTES)
        with self.ledger.open("ab") as stream:
            stream.write(b"\n")
        self.run_cli()
        self.assertEqual(len(self.events()), 1)
        self.assertEqual(self.manifest()["scan"]["invalid_rows"], 0)
        self.assertEqual(self.manifest()["scan"]["deferred_tail_bytes"], 0)

    def test_oversized_payload_is_counted_once_and_later_rows_export(self):
        self.ledger.write_bytes(self.payload(MAX_LINE_BYTES + 1) + b"\n")
        self.append(self.row(t="2026-11-17T23:40:00Z", response_id="next"))
        self.run_cli()
        self.assertEqual(len(self.events()), 1)
        self.assertEqual(self.events()[0]["ts_utc"], "2026-11-17T23:40:00.000000000Z")
        self.assertEqual(self.manifest()["scan"]["invalid_rows"], 1)
        self.assertEqual(self.manifest()["scan"]["deferred_tail_bytes"], 0)
        self.run_cli()
        self.assertEqual(self.manifest()["scan"]["invalid_rows"], 1)

    def test_multichunk_oversized_tail_is_deferred_until_terminated(self):
        payload = self.payload(3 * MAX_LINE_BYTES)
        self.ledger.write_bytes(payload)
        self.run_cli()
        self.assertEqual(self.manifest()["scan"]["invalid_rows"], 0)
        self.assertEqual(self.manifest()["scan"]["deferred_tail_bytes"], len(payload))
        with self.ledger.open("ab") as stream:
            stream.write(b"\n")
        self.append(self.row(t="2026-11-17T23:40:00Z", response_id="next"))
        self.run_cli()
        self.assertEqual(len(self.events()), 1)
        self.assertEqual(self.manifest()["scan"]["invalid_rows"], 1)
        self.assertEqual(self.manifest()["scan"]["deferred_tail_bytes"], 0)
