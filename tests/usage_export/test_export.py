from support import ExportCase


class ExportContract(ExportCase):
    def test_exports_utc_days_with_timezone_and_missing_coverage(self):
        self.append(self.row())
        self.run_cli()
        manifest = self.manifest()
        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["report_timezone"], "Europe/Paris")
        self.assertEqual([day["coverage"] for day in manifest["days"]],
                         ["missing", "partial", "missing"])
        event, = self.events()
        self.assertEqual(event["ts_utc"], "2026-11-17T23:30:00.123456789Z")
        self.assertEqual(event["report_day"], "2026-11-18")
        self.assertEqual(event["tokens"]["input"], 100)
        self.assertEqual(event["duration_ms"], 250)
        self.assertEqual(event["cost"]["estimate_usd"], None)
        self.assertEqual(event["cost"]["billed_usd"], None)
        self.assertEqual(manifest["days"][1]["workload"]["unpriced_events"], 1)
