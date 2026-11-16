#!/usr/bin/env python3
"""P0: prohibit irreversible NFC lock/auth/raw-write operations in shipped Mobile code.

Run from the repository root or anywhere. Fail closed when scanning cannot complete.
Tests and documentation are excluded because they are not shipped into the Android app.

Two layers:
1. DENIED — dangerous APIs and raw command bytes, whatever container builds them
   (array literal, Uint8Array.of / Uint8Array.from / new Uint8Array / Buffer.from).
2. Allow-list — every raw ``transceive(`` call must pass an inline literal whose first
   byte is a read-only NTAG command. A variable, spread or computed first byte fails,
   so a write command cannot be smuggled in through indirection.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
TARGETS = (ROOT / "Mobile" / "src", ROOT / "Mobile" / "plugins")
ENTRYPOINTS = (ROOT / "Mobile" / "App.tsx",)
SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".java", ".kt"}
SKIP = re.compile(r"(?:\.test|\.spec)\.[cm]?[jt]sx?$")

# Opening of a byte container, up to (but excluding) its first element.
_OPEN = (r"(?:\[\s*"
         r"|Uint8Array\s*\.\s*of\s*\(\s*"
         r"|(?:Uint8Array\s*\.\s*from|new\s+Uint8Array|Buffer\s*\.\s*from)\s*\(\s*\[\s*)")


def _first_byte(*codes):
    values = "|".join(codes)
    return re.compile(_OPEN + r"(?:" + values + r")\b", re.I)


# NTAG21x: WRITE A2h, COMPATIBILITY_WRITE A0h, PWD_AUTH 1Bh (decimal 162, 160, 27).
_WRITE = _first_byte("0xA2", "162", "0xA0", "160")
_PWD_AUTH = _first_byte("0x1B", "27")

DENIED = (
    ("irreversible_NDEF_lock", re.compile(r"\bmakeReadOnly\b")),
    ("formatting", re.compile(r"\bformatNdef\b")),
    ("raw_page_write_api", re.compile(r"\b(?:mifareUltralightWritePage|mifareClassicWriteBlock|writePage|writeBlock)\b")),
    ("NFC_A_WRITE_command", _WRITE),
    ("NFC_A_PWD_AUTH_command", _PWD_AUTH),
)

# Read-only NTAG21x commands: GET_VERSION 60h, READ 30h, FAST_READ 3Ah, READ_CNT 39h, READ_SIG 3Ch.
ALLOWED_TRANSCEIVE = re.compile(
    r"\btransceive\s*\(\s*" + _OPEN + r"(?:0x60|96|0x30|48|0x3A|58|0x39|57|0x3C|60)\s*[,\])]", re.I)
TRANSCEIVE_CALL = re.compile(r"\btransceive\s*\(")


def transceive_findings(source):
    """Offsets of transceive( calls that are not an allow-listed inline read command."""
    return [m.start() for m in TRANSCEIVE_CALL.finditer(source)
            if not ALLOWED_TRANSCEIVE.match(source, m.start())]


def scan(source):
    findings = []
    for name, rx in DENIED:
        findings += [(match.start(), name) for match in rx.finditer(source)]
    findings += [(offset, "transceive_not_allowlisted") for offset in transceive_findings(source)]
    return sorted(findings)


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
        for offset, name in scan(data):
            lineno = data.count("\n", 0, offset) + 1
            findings.append(f"{path.relative_to(ROOT)}:{lineno}: {name}")
    if findings:
        print("FAIL: NFC permanent-lock / raw-write safety gate:")
        print("\n".join(findings))
        return 1
    print(f"PASS: NFC lock/write guard scanned {len(paths)} implementation files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
