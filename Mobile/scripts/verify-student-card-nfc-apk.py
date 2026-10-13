"""Verify the produced APK, not just Expo's source configuration. No device claims."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

PREPROD_API = "https://api-preprod.somafrik.app"
PACKAGE = "com.somafrik.app"


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def tool(name):
    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or "")
    candidates = sorted(sdk.glob(f"build-tools/*/{name}"), reverse=True) if str(sdk) != "." else []
    candidate = next((p for p in candidates if p.is_file()), None)
    if candidate is None:
        installed = shutil.which(name)
        if installed:
            return installed
        raise RuntimeError(f"Android tool missing: {name}")
    return str(candidate)


def verify_archive(archive):
    names = archive.namelist()
    configs = [name for name in names if name == "assets/app.config"]
    assert len(configs) == 1, "Packaged Expo app.config missing or ambiguous"
    config = json.loads(archive.read(configs[0]))
    extra = config.get("extra", {})
    assert extra.get("releaseProfile") == "preview", "Only preview APK is permitted"
    assert extra.get("apiUrl") == PREPROD_API, "Packaged API must be exactly canonical preproduction"
    assert extra.get("demoMode") is False, "Demo mode forbidden"
    assert config.get("android", {}).get("package") == PACKAGE, "Package mismatch"
    assert "assets/index.android.bundle" in names, "APK requires an embedded JS/Hermes bundle"
    assert len(archive.read("assets/index.android.bundle")) > 10000, "Embedded bundle is missing/truncated"
    assert "lib/arm64-v8a/libhermes.so" in names, "ARM64 Hermes runtime missing"
    patterns = [rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", rb'"type"\s*:\s*"service_account"',
                rb"(?:SUPABASE_SERVICE_ROLE_KEY|JWT_PRIVATE_KEY|SMTP_PASSWORD)\s*[:=]\s*[\"'][^\"']+[\"']"]
    # Inspect all executable/data entries; public Firebase client config is expected.
    scanned = 0
    for name in names:
        if name.startswith("assets/") or re.match(r"classes\d*\.dex$", name):
            value = archive.read(name)
            for pattern in patterns:
                assert not re.search(pattern, value), f"Server secret pattern detected in {name}"
            assert b"https://api.somafrik.app" not in value and b"http://api.somafrik.app" not in value, f"Production API URL embedded in {name}"
            scanned += 1
    return config, scanned


def verify_badging(badging, config):
    package = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging)
    assert package and package[1] == PACKAGE, "Compiled application ID mismatch"
    assert package[3] == config.get("version"), "Compiled version name differs from embedded Expo config"
    assert int(package[2]) == config.get("android", {}).get("versionCode"), "Compiled version code differs from embedded Expo config"
    minimum = re.search(r"sdkVersion:'(\d+)'", badging)
    target = re.search(r"targetSdkVersion:'(\d+)'", badging)
    assert minimum and 24 <= int(minimum[1]) < 31, "Minimum SDK must preserve existing pre-Android-12 support"
    assert target and int(target[1]) >= 31, "Android target SDK incompatible with NFC bridge requirements"
    return {"versionName": package[3], "versionCode": int(package[2]), "minSdk": int(minimum[1]), "targetSdk": int(target[1])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("apk", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert args.apk.is_file(), "APK missing"
    with zipfile.ZipFile(args.apk) as archive:
        config, scanned = verify_archive(archive)
    aapt = tool("aapt2")
    badging = run(aapt, "dump", "badging", str(args.apk))
    versions = verify_badging(badging, config)
    manifest = run(aapt, "dump", "xmltree", str(args.apk), "--file", "AndroidManifest.xml")
    assert "android.permission.NFC" in manifest, "NFC permission missing"
    for permission in ["READ_MEDIA_IMAGES", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "RECORD_AUDIO", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "READ_CONTACTS", "CALL_PHONE"]:
        assert f"android.permission.{permission}" not in manifest, f"Forbidden permission {permission}"
    feature = next((block for block in re.split(r"\n\s*E:", manifest) if "uses-feature" in block and "android.hardware.nfc" in block), "")
    assert re.search(r"android:required.*(?:0x0|false)", feature), "NFC must remain optional"
    assert re.search(r"android:allowBackup.*(?:0x0|false)", manifest), "Backup must be disabled"
    assert not re.search(r"android:debuggable.*(?:0xffffffff|true)", manifest), "Preview release must not depend on Metro debugging"
    assert re.search(r"android:usesCleartextTraffic.*(?:0x0|false)", manifest), "Cleartext traffic must be disabled"
    signature = run(tool("apksigner"), "verify", "--verbose", "--print-certs", str(args.apk))
    assert "Verified" in signature, "APK signature verification failed"
    assert "CN=Android Debug" in signature, "This workflow must use the test certificate, never the production certificate"
    certificate = re.search(r"Signer #1 certificate SHA-256 digest: ([0-9a-fA-F]+)", signature)
    assert certificate and len(certificate[1]) == 64, "Test certificate fingerprint missing"
    sha = run("git", "rev-parse", "HEAD").strip()
    assert re.fullmatch(r"[0-9a-f]{40}", sha), "Candidate SHA missing"
    evidence = {"candidateSha": sha, "apkSha256": hashlib.sha256(args.apk.read_bytes()).hexdigest(),
                "bytes": args.apk.stat().st_size, "package": PACKAGE, "apiUrl": PREPROD_API,
                "releaseProfile": "preview", "abi": "arm64-v8a", "signing": "Android Debug (test only)",
                **versions, "certificateSha256": certificate[1].lower(), "productionApiUrlAbsent": True,
                "embeddedConfigChecked": True, "embeddedBundleChecked": True, "secretPatternEntriesChecked": scanned,
                "nativeManifestChecked": True, "physicalSmoke": "NOT_RUN", "status": "DRAFT/HOLD"}
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / f"somafrik-nfc-preview-{sha[:12]}.apk"
    shutil.copyfile(args.apk, output)
    (args.output / "apk-evidence.json").write_text(json.dumps(evidence, indent=2)+"\n")
    (args.output / "manifest-evidence.txt").write_text(manifest)
    (args.output / "signature-evidence.txt").write_text(signature)
    (args.output / "badging-evidence.txt").write_text(badging)
    print(json.dumps(evidence, indent=2))
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # Public, sanitized build metadata remains reviewable through the check
        # annotations API even when artifact downloads are unavailable to a client.
        print("::notice title=NFC APK evidence::" + json.dumps(evidence, separators=(",", ":")))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with Path(summary).open("a") as stream:
                stream.write("### NFC preview APK — exact HEAD, physical tests NOT RUN\n\n```json\n")
                stream.write(json.dumps(evidence, indent=2) + "\n```\n")


if __name__ == "__main__":
    main()
