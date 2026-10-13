import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile
import sys
sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location("nfc_apk", Path(__file__).with_name("verify-student-card-nfc-apk.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackagedConfigTests(unittest.TestCase):
    def archive(self, overrides=None, missing_bundle=False, secret=False, production_url=False):
        config = {"version": "1.2.1", "extra": {"releaseProfile": "preview", "apiUrl": module.PREPROD_API, "demoMode": False}, "android": {"package": module.PACKAGE, "versionCode": 13}}
        config["extra"].update(overrides or {})
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            archive.writestr("assets/app.config", json.dumps(config))
            if not missing_bundle:
                payload = b"x" * 11000
                if secret:
                    payload += b"-----BEGIN " + b"PRIVATE KEY-----"
                if production_url:
                    payload += b"https://api.somafrik.app"
                archive.writestr("assets/index.android.bundle", payload)
            archive.writestr("lib/arm64-v8a/libhermes.so", b"test runtime")
        data.seek(0)
        return zipfile.ZipFile(data)

    def test_preview_config_is_checked_inside_archive(self):
        with self.archive() as archive:
            config, count = module.verify_archive(archive)
        self.assertEqual(config["extra"]["apiUrl"], module.PREPROD_API)
        self.assertGreaterEqual(count, 2)

    def test_production_or_unknown_api_and_profile_rejected(self):
        for overrides in [{"apiUrl": "https://api.somafrik.app"}, {"apiUrl": "https://other.invalid"}, {"releaseProfile": "production"}, {"demoMode": True}]:
            with self.subTest(overrides=overrides), self.archive(overrides) as archive:
                with self.assertRaises(AssertionError):
                    module.verify_archive(archive)

    def test_missing_bundle_or_private_key_pattern_rejected(self):
        for options in [{"missing_bundle": True}, {"secret": True}]:
            with self.subTest(options=options), self.archive(**options) as archive:
                with self.assertRaises(AssertionError):
                    module.verify_archive(archive)

    def test_production_api_in_bundle_rejected_even_with_preview_config(self):
        with self.archive(production_url=True) as archive:
            with self.assertRaises(AssertionError):
                module.verify_archive(archive)

    def test_apksigner_v2_sha256_digest_format(self):
        import re
        signature = ("Verifies\n"
                     "V2 Signer #1 certificate DN: CN=Android Debug\n"
                     "V2 Signer #1 certificate SHA-256 digest: " + "a1" * 32 + "\n")
        digest = re.search(
            r"^(?:V[123] )?Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F: ]+)\s*$",
            signature, re.IGNORECASE | re.MULTILINE,
        )
        self.assertIsNotNone(digest)
        self.assertEqual(digest[1], "a1" * 32)
        self.assertIsNone(re.search(
            r"^(?:V[123] )?Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F: ]+)\s*$",
            signature.replace("SHA-256", "SHA-1"), re.IGNORECASE | re.MULTILINE,
        ))

    def test_compiled_versions_and_android_compatibility(self):
        config = {"version": "1.2.1", "android": {"versionCode": 13}}
        badging = f"package: name='{module.PACKAGE}' versionCode='13' versionName='1.2.1'\nsdkVersion:'24'\ntargetSdkVersion:'36'"
        self.assertEqual(module.verify_badging(badging, config), {"versionName": "1.2.1", "versionCode": 13, "minSdk": 24, "targetSdk": 36})
        actual_aapt2 = badging.replace("sdkVersion:'24'", "minSdkVersion:'24'")
        self.assertEqual(module.verify_badging(actual_aapt2, config)["minSdk"], 24)
        with self.assertRaises(AssertionError):
            module.verify_badging(actual_aapt2.replace("minSdkVersion:'24'", "minSdkVersion:'31'"), config)
        for invalid in [badging.replace("versionCode='13'", "versionCode='14'"), badging.replace("versionName='1.2.1'", "versionName='2.0.0'"), badging.replace("sdkVersion:'24'", "sdkVersion:'31'"), badging.replace("targetSdkVersion:'36'", "targetSdkVersion:'30'")]:
            with self.subTest(badging=invalid), self.assertRaises(AssertionError):
                module.verify_badging(invalid, config)


if __name__ == "__main__":
    unittest.main()
