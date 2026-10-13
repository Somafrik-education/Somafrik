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
            scanned += 1
    return config, scanned


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
    assert f"package: name='{PACKAGE}'" in badging, "Compiled application ID mismatch"
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
    sha = run("git", "rev-parse", "HEAD").strip()
    assert re.fullmatch(r"[0-9a-f]{40}", sha), "Candidate SHA missing"
    evidence = {"candidateSha": sha, "apkSha256": hashlib.sha256(args.apk.read_bytes()).hexdigest(),
                "bytes": args.apk.stat().st_size, "package": PACKAGE, "apiUrl": PREPROD_API,
                "releaseProfile": "preview", "abi": "arm64-v8a", "signing": "Android Debug (test only)",
                "embeddedConfigChecked": True, "embeddedBundleChecked": True, "secretPatternEntriesChecked": scanned,
                "nativeManifestChecked": True, "physicalSmoke": "NOT_RUN", "status": "DRAFT/HOLD"}
    args.output.mkdir(parents=True, exist_ok=True)
    output = args.output / f"somafrik-nfc-preview-{sha[:12]}.apk"
    shutil.copyfile(args.apk, output)
    (args.output / "apk-evidence.json").write_text(json.dumps(evidence, indent=2)+"\n")
    (args.output / "manifest-evidence.txt").write_text(manifest)
    (args.output / "signature-evidence.txt").write_text(signature)
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
