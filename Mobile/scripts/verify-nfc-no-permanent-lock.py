#!/usr/bin/env python3
"""P0: prohibit irreversible NFC lock/auth/raw-write operations in shipped Mobile code.

Run from the repository root or anywhere. Fail closed when scanning cannot complete.
Tests and documentation are excluded because they are not shipped into the Android app.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGETS = (ROOT / "Mobile" / "src", ROOT / "Mobile" / "plugins")
ENTRYPOINTS = (ROOT / "Mobile" / "App.tsx",)
SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".java", ".kt"}
SKIP = re.compile(r"(?:\.test|\.spec)\.[cm]?[jt]sx?$")
DENIED = (
    ("irreversible_NDEF_lock", re.compile(r"\bmakeReadOnly\s*\(")),
    ("formatting", re.compile(r"\bformatNdef\s*\(")),
    ("NFC_A_WRITE_command", re.compile(r"\btransceive\s*\(\s*(?:\[\s*(?:0xA2|162)\b|Uint8Array\.of\s*\(\s*(?:0xA2|162)\b)", re.I)),
    ("NFC_A_PWD_AUTH_command", re.compile(r"\btransceive\s*\(\s*(?:\[\s*(?:0x1B|27)\b|Uint8Array\.of\s*\(\s*(?:0x1B|27)\b)", re.I)),
)
def main() -> int:
    paths = []
    for root in TARGETS:
        if not root.is_dir():
            print(f"FAIL: NFC guard directory missing: {root}", file=sys.stderr)
            return 2
        paths += [p for p in root.rglob("*") if p.is_file() and p.suffix in SUFFIXES and not SKIP.search(p.name)]
    for path in ENTRYPOINTS:
        if not path.is_file():
            print(f"FAIL: NFC guard entrypoint missing: {path}", file=sys.stderr)
            return 2
        paths.append(path)
    if not paths:
        print("FAIL: no Mobile implementation files scanned", file=sys.stderr)
        return 2
    findings = []
    for path in paths:
        try:
            data = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            print(f"FAIL: cannot scan {path}: {exc}", file=sys.stderr)
            return 2
        for name, rx in DENIED:
            for match in rx.finditer(data):
                lineno = data.count("\n", 0, match.start()) + 1
                findings.append(f"{path.relative_to(ROOT)}:{lineno}: {name}")
    if findings:
        print("FAIL: NFC permanent-lock / raw-write safety gate:")
        print("\n".join(findings))
        return 1
    print(f"PASS: NFC lock/write guard scanned {len(paths)} implementation files")
    return 0
if __name__ == "__main__":
    sys.exit(main())
