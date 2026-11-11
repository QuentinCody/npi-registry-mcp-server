import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from extract_v2 import extract


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / "fixture.zip"
        self.url = "https://download.cms.gov/nppes/fixture_V2.zip"
        self.npi = "1234567893"

    def tearDown(self):
        self.temp.cleanup()

    def bundle(self, files):
        with zipfile.ZipFile(self.archive, "w") as bundle:
            for name, contents in files.items():
                bundle.writestr(name, contents)
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def run_extract(self, digest, members, **overrides):
        args = dict(archive=self.archive, expected_sha256=digest, source_url=self.url,
                    release_kind="monthly_snapshot", release_label="Synthetic V2 fixture", members=members, npis=[self.npi])
        args.update(overrides)
        return extract(**args)

    def test_preserves_long_unicode_names_quoted_newlines_leading_zero_and_reference_multiplicity(self):
        name = "Clinique α " * 100
        main = f'\ufeff"NPI","Provider Organization Name (Legal Business Name)","ZIP"\r\n"{self.npi}","{name}\nline two","00123"\r\n"9999999999","Unselected","00000"\r\n'
        locations = f'NPI,Address\n{self.npi},One\n{self.npi},Two\n'
        digest = self.bundle({"main.csv": main, "locations.csv": locations})
        result = self.run_extract(digest, [("providers", "main.csv"), ("practice_locations", "locations.csv")])
        self.assertEqual(result["files"][0]["rows"][0]["Provider Organization Name (Legal Business Name)"], name + "\nline two")
        self.assertEqual(result["files"][0]["rows"][0]["ZIP"], "00123")
        self.assertEqual(len(result["files"][1]["rows"]), 2)
        self.assertEqual(result["files"][0]["member_sha256"], hashlib.sha256(main.encode()).hexdigest())
        self.assertTrue(result["files"][0]["complete_scan"])

    def test_deactivation_and_reactivation_dates_not_normalized(self):
        digest = self.bundle({"data.csv": f'NPI,NPI Deactivation Date,NPI Reactivation Date\n{self.npi},01/01/2025,02/01/2025\n'})
        result = self.run_extract(digest, [("deactivations", "data.csv")], release_kind="deactivation")
        self.assertEqual(result["files"][0]["rows"][0]["NPI Reactivation Date"], "02/01/2025")
        self.assertNotIn("active", json.dumps(result))

    def test_checksum_mismatch(self):
        self.bundle({"data.csv": "NPI\n"})
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            self.run_extract("0" * 64, [("providers", "data.csv")])

    def test_bad_rows_after_requested_match_fail_complete_scan(self):
        digest = self.bundle({"data.csv": f'NPI,Name\n{self.npi},One\n9999999999,Extra,Cell\n'})
        with self.assertRaisesRegex(ValueError, "row width"):
            self.run_extract(digest, [("providers", "data.csv")])

    def test_duplicate_headers(self):
        digest = self.bundle({"data.csv": "NPI,NPI\n"})
        with self.assertRaisesRegex(ValueError, "unique"):
            self.run_extract(digest, [("providers", "data.csv")])

    def test_unknown_member_kind(self):
        digest = self.bundle({"data.csv": "NPI\n"})
        with self.assertRaises(ValueError):
            self.run_extract(digest, [("unknown", "data.csv")])

    def test_wrong_source_host(self):
        digest = self.bundle({"data.csv": "NPI\n"})
        with self.assertRaises(ValueError):
            self.run_extract(digest, [("providers", "data.csv")], source_url="https://evil.test/file.zip")

    def test_empty_match_still_hashes_full_member(self):
        contents = "NPI,Name\n9999999999,Other\n"
        digest = self.bundle({"data.csv": contents})
        result = self.run_extract(digest, [("providers", "data.csv")])
        self.assertEqual(result["files"][0]["rows"], [])
        self.assertEqual(result["files"][0]["member_sha256"], hashlib.sha256(contents.encode()).hexdigest())

    def test_row_limit_rejects_instead_of_silent_truncation(self):
        digest = self.bundle({"data.csv": "NPI\n" + (self.npi + "\n") * 1001})
        with self.assertRaisesRegex(ValueError, "1000"):
            self.run_extract(digest, [("providers", "data.csv")])

    def test_byte_limit(self):
        digest = self.bundle({"data.csv": f'NPI,Name\n{self.npi},' + "x" * 1048576})
        with self.assertRaisesRegex(ValueError, "1 MiB"):
            self.run_extract(digest, [("providers", "data.csv")])

    def test_cli_publishes_only_complete_packet_and_refuses_overwrite(self):
        digest = self.bundle({"data.csv": f'NPI,Name\n{self.npi},Fixture\n'})
        output = self.root / "out.json"
        command = [sys.executable, str(Path(__file__).with_name("extract_v2.py")), "--archive", str(self.archive), "--expected-sha256", digest, "--source-url", self.url, "--release-kind", "monthly_snapshot", "--release-label", "Fixture V2", "--member", "providers=data.csv", "--npi", self.npi, "--out", str(output)]
        self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)
        original = output.read_bytes()
        self.assertEqual(json.loads(original)["npis"], [self.npi])
        self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
        self.assertEqual(output.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
