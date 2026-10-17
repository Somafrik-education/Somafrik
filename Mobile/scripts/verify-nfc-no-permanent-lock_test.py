#!/usr/bin/env python3
"""Regression tests for dangerous NFC command spellings."""
import importlib.util
from pathlib import Path
import unittest

GUARD = Path(__file__).with_name("verify-nfc-no-permanent-lock.py")
spec = importlib.util.spec_from_file_location("nfc_guard", GUARD)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

def detections(source):
    return {name for name, regex in guard.DENIED if regex.search(source)}

class NfcGuardTests(unittest.TestCase):
    def test_entrypoint_is_scanned(self):
        self.assertIn(guard.ROOT / "Mobile" / "App.tsx", guard.ENTRYPOINTS)
    def test_hex_and_decimal_direct_write(self):
        for code in ("transceive([0xA2, 1])", "transceive([162, 1])",
                     "transceive(Uint8Array.of(162, 1))",
                     "transceive(Uint8Array.of(0xA2, 1))"):
            with self.subTest(code=code):
                self.assertIn("NFC_A_WRITE_command", detections(code))
    def test_password_auth(self):
        for code in ("transceive([0x1B, 1])", "transceive([27, 1])",
                     "transceive(Uint8Array.of(27, 1))"):
            with self.subTest(code=code):
                self.assertIn("NFC_A_PWD_AUTH_command", detections(code))
    def test_irreversible_lock_and_format(self):
        self.assertIn("irreversible_NDEF_lock", detections("handler.makeReadOnly()"))
        self.assertIn("formatting", detections("handler.formatNdef()"))
    def test_allowed_read_command(self):
        self.assertFalse(detections("transceive([0x60])"))

if __name__ == "__main__":
    unittest.main()
