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


# Captured from build-tools 37.0.0 `apksigner verify --verbose --print-certs`
# on a v2-only APK signed with CN=Android Debug. This is the line shape that
# GitHub ubuntu-24.04 produces, because that image preinstalls build-tools 37.0.0
# and the verifier selects the newest build-tools package.
BUILD_TOOLS_37_V2 = """Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v3.2 scheme (APK Signature Scheme v3.2): false
Verified using v4 scheme (APK Signature Scheme v4): false
Verified for SourceStamp: false
Number of signers: 1
V2 Signer: certificate DN: CN=Android Debug, O=Android, C=US
V2 Signer: certificate SHA-256 digest: d2c96cb19de2ee46f3f575daa803f567f2df19c261df8f4b46ebdae77c229235
V2 Signer: certificate SHA-1 digest: 3674fc4207d941fc2ad6fe4643525a8a11a4b658
V2 Signer: certificate MD5 digest: f5e7542e6072f913ff81a873dc88fb08
V2 Signer: key algorithm: RSA
V2 Signer: key size (bits): 2048
V2 Signer: public key SHA-256 digest: 93a38f8b159ed37110aa875cb5e07ec4d3cfdf457e50c3200371331f26d978d1
V2 Signer: public key SHA-1 digest: a41aac03f6ce60239c5eaa6ac3c24ce5a1676076
V2 Signer: public key MD5 digest: 2e1adcf32fd656140509981468fde447
"""

BUILD_TOOLS_36_V2 = BUILD_TOOLS_37_V2.replace(
    "Verified using v3.2 scheme (APK Signature Scheme v3.2): false\n",
    "",
).replace("V2 Signer: ", "Signer #1 ")

BUILD_TOOLS_37_V3 = BUILD_TOOLS_37_V2.replace(
    "Verified using v3 scheme (APK Signature Scheme v3): false",
    "Verified using v3 scheme (APK Signature Scheme v3): true",
).replace("V2 Signer: ", "V3.0 Signer: ")

BUILD_TOOLS_37_OTHER = BUILD_TOOLS_37_V2.replace(
    "CN=Android Debug, O=Android, C=US",
    "CN=Not The Test Cert, O=Example, C=US",
).replace(
    "d2c96cb19de2ee46f3f575daa803f567f2df19c261df8f4b46ebdae77c229235",
    "24dcc466942e995e30e886f8800935f4c00358fd66230edeb1f426084acb6ec6",
)

BUILD_TOOLS_37_TWO_SIGNERS = """Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Verified using v3.2 scheme (APK Signature Scheme v3.2): false
Verified using v4 scheme (APK Signature Scheme v4): false
Verified for SourceStamp: false
Number of signers: 2
V2 Signer #1: certificate DN: CN=Android Debug, O=Android, C=US
V2 Signer #1: certificate SHA-256 digest: d2c96cb19de2ee46f3f575daa803f567f2df19c261df8f4b46ebdae77c229235
V2 Signer #1: certificate SHA-1 digest: 3674fc4207d941fc2ad6fe4643525a8a11a4b658
V2 Signer #1: certificate MD5 digest: f5e7542e6072f913ff81a873dc88fb08
V2 Signer #2: certificate DN: CN=Not The Test Cert, O=Example, C=US
V2 Signer #2: certificate SHA-256 digest: 24dcc466942e995e30e886f8800935f4c00358fd66230edeb1f426084acb6ec6
V2 Signer #2: certificate SHA-1 digest: 8da71e4848dce2e9a33badfecf9a9e02d462dca2
V2 Signer #2: certificate MD5 digest: 56ec094e4d55c4074f1b3a95f24d033c
"""

DEBUG_SHA256 = "d2c96cb19de2ee46f3f575daa803f567f2df19c261df8f4b46ebdae77c229235"
PUBLIC_KEY_SHA256 = "93a38f8b159ed37110aa875cb5e07ec4d3cfdf457e50c3200371331f26d978d1"
PREVIOUS_PATTERN = r"^(?:V[123] )?Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F: ]+)\s*$"


def _colon_separated(fingerprint):
    return ":".join(fingerprint[index:index + 2] for index in range(0, len(fingerprint), 2))


class SignatureVerificationTests(unittest.TestCase):
    def assert_rejected(self, output, code=0, text=None):
        with self.assertRaises(module.ApkSignatureVerificationError) as caught:
            module.verify_apk_signature(output, apksigner_exit_code=code)
        if text:
            self.assertIn(text, str(caught.exception))
        return str(caught.exception)

    def test_production_verifier_calls_verify_apk_signature(self):
        source = Path(module.__file__).read_text()
        self.assertIn("fingerprint = verify_apk_signature(", source)
        self.assertNotIn("Signer #1 certificate SHA-256 digest:", source)

    def test_build_tools_37_sorts_above_preinstalled_36(self):
        newer = module._build_tools_sort_key(Path("build-tools/37.0.0/apksigner"))
        older = module._build_tools_sort_key(Path("build-tools/36.1.0/apksigner"))
        self.assertGreater(newer, older)

    def test_real_build_tools_37_v2_output(self):
        import re
        self.assertIsNone(re.search(PREVIOUS_PATTERN, BUILD_TOOLS_37_V2, re.IGNORECASE | re.MULTILINE))
        fingerprint = module.verify_apk_signature(BUILD_TOOLS_37_V2)
        self.assertEqual(fingerprint, DEBUG_SHA256)
        self.assertNotEqual(fingerprint, PUBLIC_KEY_SHA256)
        self.assertEqual(len(fingerprint), 64)

    def test_android_debug_certificate_and_plain_hex_digest(self):
        self.assertEqual(module.verify_apk_signature(BUILD_TOOLS_37_V2), DEBUG_SHA256)
        self.assertRegex(module.verify_apk_signature(BUILD_TOOLS_37_V2), r"[0-9a-f]{64}")

    def test_observed_v2_signer_label_and_older_signer_number_label(self):
        self.assertEqual(module.verify_apk_signature(BUILD_TOOLS_37_V2), DEBUG_SHA256)
        self.assertEqual(module.verify_apk_signature(BUILD_TOOLS_36_V2), DEBUG_SHA256)

    def test_same_certificate_repeated_by_v2_and_v3_is_one_certificate(self):
        combined = BUILD_TOOLS_37_V2 + "\n" + "\n".join(
            line for line in BUILD_TOOLS_37_V3.splitlines() if "certificate" in line
        )
        self.assertEqual(module.verify_apk_signature(combined), DEBUG_SHA256)
        self.assertEqual(module.verify_apk_signature(BUILD_TOOLS_37_V3), DEBUG_SHA256)

    def test_allowed_colon_and_whitespace_separators(self):
        colon = BUILD_TOOLS_37_V2.replace(DEBUG_SHA256, _colon_separated(DEBUG_SHA256))
        spaced = BUILD_TOOLS_37_V2.replace(DEBUG_SHA256, " ".join(_colon_separated(DEBUG_SHA256).split(":")))
        self.assertEqual(module.verify_apk_signature(colon), DEBUG_SHA256)
        self.assertEqual(module.verify_apk_signature(spaced), DEBUG_SHA256)

    def test_missing_certificate_rejected(self):
        without_certificate = "\n".join(
            line for line in BUILD_TOOLS_37_V2.splitlines() if "certificate" not in line
        )
        self.assert_rejected(without_certificate, text="missing")

    def test_empty_truncated_and_illegal_digests_rejected(self):
        self.assert_rejected(BUILD_TOOLS_37_V2.replace(DEBUG_SHA256, ""), text="empty")
        self.assert_rejected(BUILD_TOOLS_37_V2.replace(DEBUG_SHA256, DEBUG_SHA256[:-1]), text="truncated")
        self.assert_rejected(BUILD_TOOLS_37_V2.replace(DEBUG_SHA256, "g" + DEBUG_SHA256[1:]), text="characters")
        self.assert_rejected(BUILD_TOOLS_37_V2.replace(DEBUG_SHA256, _colon_separated(DEBUG_SHA256).replace(":", "-")), text="characters")

    def test_unauthorized_certificate_rejected(self):
        self.assert_rejected(BUILD_TOOLS_37_OTHER, text="Android test certificate")

    def test_multiple_distinct_certificates_rejected(self):
        message = self.assert_rejected(BUILD_TOOLS_37_TWO_SIGNERS, text="distinct")
        self.assertIn("V2 Signer #1:", message)
        self.assertIn("V2 Signer #2:", message)

    def test_unsigned_invalid_and_malformed_output_rejected(self):
        self.assert_rejected("DOES NOT VERIFY\nERROR: Missing META-INF/MANIFEST.MF\n", code=1, text="unsigned")
        self.assert_rejected("DOES NOT VERIFY\n", text="does not verify")
        self.assert_rejected(BUILD_TOOLS_37_V2, code=1, text="unsigned")
        self.assert_rejected("Verifies\nNumber of signers: 1\n", text="verified signature scheme")
        self.assert_rejected("", text="verified signature scheme")

    def test_diagnostic_keeps_signer_field_and_redacts_secrets(self):
        diagnostic = module.sanitized_signature_diagnostic(
            BUILD_TOOLS_37_V2 + "storePassword android\n-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n",
            0,
            "/usr/local/lib/android/sdk/build-tools/37.0.0/apksigner",
        )
        self.assertIn("V2 Signer:", diagnostic)
        self.assertIn("certificate SHA-256 digest:", diagnostic)
        self.assertNotIn("SECRET", diagnostic)
        self.assertNotIn("storePassword android", diagnostic)
        self.assertIn("[redacted", diagnostic)

    def test_live_installed_apksigner_when_sdk_present(self):
        import os
        import re
        import shutil
        import subprocess
        import tempfile
        sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
        if not sdk or not Path(sdk, "build-tools").is_dir():
            self.skipTest("Android SDK build-tools are not installed")
        signer = module.tool("apksigner")
        build_tools = Path(signer).parent.name
        aapt2 = Path(signer).with_name("aapt2")
        platforms = sorted(Path(sdk, "platforms").glob("android-*/android.jar"))
        if not aapt2.is_file() or not platforms or shutil.which("keytool") is None:
            self.skipTest("aapt2, android.jar, or keytool is unavailable")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "AndroidManifest.xml"
            manifest.write_text(
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
                "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"com.example.tiny\" "
                "android:versionCode=\"1\" android:versionName=\"1.0\">\n"
                "  <uses-sdk android:minSdkVersion=\"24\" android:targetSdkVersion=\"36\"/>\n"
                "  <application android:label=\"tiny\" android:hasCode=\"false\"/>\n"
                "</manifest>\n"
            )
            unsigned = root / "unsigned.apk"
            keystore = root / "debug.keystore"
            subprocess.run(
                ["keytool", "-genkeypair", "-keystore", str(keystore), "-storepass", "android",
                 "-alias", "androiddebugkey", "-keypass", "android", "-keyalg", "RSA", "-keysize", "2048",
                 "-validity", "1", "-dname", "CN=Android Debug, O=Android, C=US"],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                [str(aapt2), "link", "-o", str(unsigned), "--manifest", str(manifest), "-I", str(platforms[-1])],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            signed = root / "signed.apk"
            shutil.copyfile(unsigned, signed)
            subprocess.run(
                [signer, "sign", "--ks", str(keystore), "--ks-pass", "pass:android", "--key-pass", "pass:android",
                 "--ks-key-alias", "androiddebugkey", "--v1-signing-enabled", "false",
                 "--v2-signing-enabled", "true", "--v3-signing-enabled", "false", str(signed)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            completed = subprocess.run(
                [signer, "verify", "--verbose", "--print-certs", str(signed)],
                check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            )
            fingerprint = module.verify_apk_signature(completed.stdout, apksigner_exit_code=completed.returncode)
            self.assertRegex(fingerprint, r"[0-9a-f]{64}")
            if tuple(int(part) for part in build_tools.split(".")[:1]) >= (37,):
                self.assertIn("V2 Signer: certificate SHA-256 digest:", completed.stdout)
                self.assertIsNone(re.search(PREVIOUS_PATTERN, completed.stdout, re.MULTILINE))


if __name__ == "__main__":
    unittest.main()
