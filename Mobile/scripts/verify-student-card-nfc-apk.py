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


def _build_tools_sort_key(path):
    numbers = []
    for part in path.parent.name.split("."):
        match = re.match(r"(\d+)", part)
        numbers.append(int(match.group(1)) if match else -1)
    return numbers


def tool(name):
    sdk = Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or "")
    candidates = [path for path in sdk.glob(f"build-tools/*/{name}") if path.is_file()] if str(sdk) != "." else []
    if candidates:
        # GitHub-hosted runners preinstall several build-tools side by side.
        # Lexicographic order already preferred 37.0.0 over the 36.0.0 package
        # requested by the workflow; select by numeric version and record it.
        return str(max(candidates, key=_build_tools_sort_key))
    installed = shutil.which(name)
    if installed:
        return installed
    raise RuntimeError(f"Android tool missing: {name}")


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
    minimum = re.search(r"(?:^|\n)(?:minSdkVersion|sdkVersion):'(\d+)'", badging)
    target = re.search(r"targetSdkVersion:'(\d+)'", badging)
    assert minimum, f"Compiled minimum SDK missing from aapt2 badging: {badging[:600]!r}"
    assert 24 <= int(minimum[1]) < 31, (f"Compiled minSdkVersion={minimum[1]} (expected 24..30); "
                                                f"compiled targetSdkVersion={target[1] if target else 'missing'}")
    assert target and int(target[1]) >= 31, "Android target SDK incompatible with NFC bridge requirements"
    return {"versionName": package[3], "versionCode": int(package[2]), "minSdk": int(minimum[1]), "targetSdk": int(target[1])}


class ApkSignatureVerificationError(Exception):
    """APK signature evidence is missing, invalid, or ambiguous."""


_SCHEME_VERIFIED = re.compile(
    r"^Verified using (?P<scheme>v[\d.]+) scheme \([^)]+\):\s*(?P<state>true|false)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
# Horizontal whitespace only: \s includes newlines and would attach the next
# signer line to an empty digest.
_CERT_DN = re.compile(r"^(?P<label>.*?)[ \t]+certificate DN:[ \t]*(?P<dn>\S.*?)[ \t]*$", re.MULTILINE)
_CERT_SHA256 = re.compile(
    r"^(?P<label>.*?)[ \t]+certificate SHA-256 digest:[ \t]*(?P<raw>.*?)[ \t]*$",
    re.MULTILINE,
)
_ANDROID_DEBUG_CN = re.compile(r"(?:^|[/,])\s*CN=Android Debug\s*(?:,|/|$)")
_PRIVATE_KEY_BLOCK = re.compile(
    r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
    re.IGNORECASE,
)
_SECRET_LINE = re.compile(r"storepass|keypass|(?:password|passwd)\s*[:=]", re.IGNORECASE)


def normalize_certificate_sha256(raw):
    """Accept 64 hex digits, or 32 bytes separated only by ':' or whitespace."""
    text = (raw or "").strip()
    if not text:
        raise ApkSignatureVerificationError("Certificate SHA-256 digest is empty")
    if re.fullmatch(r"[0-9a-fA-F]{64}", text):
        return text.lower()
    parts = re.split(r"[:\s]+", text)
    if len(parts) == 32 and all(re.fullmatch(r"[0-9a-fA-F]{2}", part) for part in parts):
        return "".join(parts).lower()
    raise ApkSignatureVerificationError(
        "Certificate SHA-256 digest is truncated or contains characters other than hexadecimal digits and ':' or whitespace separators"
    )


def verify_apk_signature(signature_output: str, apksigner_exit_code: int = 0) -> str:
    """Validate APK signature evidence.

    Returns:
        Normalized SHA-256 certificate fingerprint.

    Raises:
        ApkSignatureVerificationError: evidence is missing, invalid, or ambiguous.

    Build-tools 37 prints ``V2 Signer: certificate SHA-256 digest: <hex>`` for a
    single signer and ``V2 Signer #1: certificate SHA-256 digest:`` when several
    signers exist. Build-tools 36.1 and earlier print ``Signer #1 certificate
    SHA-256 digest:``. Repeated schemes that name one certificate are one
    certificate. Distinct certificates are rejected. No fingerprint is invented.
    """
    if apksigner_exit_code != 0:
        raise ApkSignatureVerificationError(
            f"apksigner exited {apksigner_exit_code}; APK is unsigned or the signature is invalid"
        )
    text = signature_output or ""
    if "DOES NOT VERIFY" in text:
        raise ApkSignatureVerificationError("apksigner reported that the APK signature does not verify")
    schemes = [(match.group("scheme"), match.group("state").lower()) for match in _SCHEME_VERIFIED.finditer(text)]
    if not schemes or not any(state == "true" for _scheme, state in schemes):
        raise ApkSignatureVerificationError(
            "apksigner did not report a verified signature scheme; signer labels: "
            + repr(_certificate_labels(text))
        )
    sha256_lines = list(_CERT_SHA256.finditer(text))
    if not sha256_lines:
        raise ApkSignatureVerificationError(
            "Certificate SHA-256 digest is missing; signer labels: " + repr(_certificate_labels(text))
        )
    fingerprints = []
    labels = []
    for match in sha256_lines:
        labels.append(match.group("label"))
        try:
            fingerprints.append(normalize_certificate_sha256(match.group("raw")))
        except ApkSignatureVerificationError as error:
            raise ApkSignatureVerificationError(f"{error}; signer label: {match.group('label')!r}") from None
    distinct = sorted(set(fingerprints))
    if len(distinct) != 1:
        raise ApkSignatureVerificationError(
            "Multiple distinct signer certificates are not allowed for this test APK; "
            f"count={len(distinct)}; signer labels: {labels!r}"
        )
    dn_lines = list(_CERT_DN.finditer(text))
    if len(dn_lines) != len(sha256_lines):
        raise ApkSignatureVerificationError(
            "Certificate identity lines do not match certificate SHA-256 lines; "
            f"dn={len(dn_lines)} sha256={len(sha256_lines)}; signer labels: {labels!r}"
        )
    for match in dn_lines:
        if not _ANDROID_DEBUG_CN.search(match.group("dn")):
            raise ApkSignatureVerificationError(
                "Signer certificate is not the Android test certificate (CN=Android Debug); "
                f"signer label: {match.group('label')!r}"
            )
    return distinct[0]


def _certificate_labels(text):
    labels = []
    for line in text.splitlines():
        if "certificate" not in line.lower():
            continue
        label, separator, _rest = line.partition(" certificate")
        labels.append(label if separator else line)
    return labels


def sanitized_signature_diagnostic(signature_output, apksigner_exit_code, tool_path):
    text = _PRIVATE_KEY_BLOCK.sub("[redacted private key]", signature_output or "")
    lines = ["[redacted secret]" if _SECRET_LINE.search(line) else line for line in text.splitlines()]
    return (
        f"apksigner_exit_code: {apksigner_exit_code}\n"
        f"apksigner_tool: {tool_path}\n"
        f"signer_labels: {_certificate_labels(text)!r}\n"
        + "\n".join(lines)
        + "\n"
    )


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
    signer = tool("apksigner")
    build_tools = Path(signer).parent.name
    completed = subprocess.run(
        [signer, "verify", "--verbose", "--print-certs", str(args.apk)],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False,
    )
    signature = completed.stdout or ""
    try:
        fingerprint = verify_apk_signature(signature, apksigner_exit_code=completed.returncode)
    except ApkSignatureVerificationError:
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / "signature-diagnostic.txt").write_text(
            sanitized_signature_diagnostic(signature, completed.returncode, f"{signer} (build-tools {build_tools})")
        )
        raise
    sha = run("git", "rev-parse", "HEAD").strip()
    assert re.fullmatch(r"[0-9a-f]{40}", sha), "Candidate SHA missing"
    evidence = {"candidateSha": sha, "apkSha256": hashlib.sha256(args.apk.read_bytes()).hexdigest(),
                "bytes": args.apk.stat().st_size, "package": PACKAGE, "apiUrl": PREPROD_API,
                "releaseProfile": "preview", "abi": "arm64-v8a", "signing": "Android Debug (test only)",
                **versions, "certificateSha256": fingerprint.lower(), "apksignerBuildTools": build_tools,
                "productionApiUrlAbsent": True,
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
