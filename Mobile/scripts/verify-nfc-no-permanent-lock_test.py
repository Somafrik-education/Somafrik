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
    return {name for _offset, name in guard.scan(source)}

class NfcGuardTests(unittest.TestCase):
    def test_entrypoint_is_scanned(self):
        self.assertIn(guard.ROOT / "Mobile" / "App.tsx", guard.ENTRYPOINTS)
    def test_hex_and_decimal_direct_write(self):
        for code in ("transceive([0xA2, 1])", "transceive([162, 1])",
                     "transceive(Uint8Array.of(162, 1))",
                     "transceive(Uint8Array.of(0xA2, 1))"):
            with self.subTest(code=code):
                self.assertIn("NFC_A_WRITE_command", detections(code))
    def test_typed_array_constructors(self):
        for code in ("transceive(new Uint8Array([0xA2, 4, 1, 2, 3, 4]))",
                     "transceive(new Uint8Array([162, 4]))",
                     "transceive(Uint8Array.from([0xa2, 4]))",
                     "transceive(Uint8Array.from( [ 162 , 4 ]))",
                     "transceive(Buffer.from([0xA2, 4]))",
                     "transceive(new  Uint8Array( [0xA0, 4]))"):
            with self.subTest(code=code):
                self.assertIn("NFC_A_WRITE_command", detections(code))
        for code in ("transceive(new Uint8Array([0x1B, 1, 2, 3, 4]))",
                     "transceive(Uint8Array.from([27, 1]))"):
            with self.subTest(code=code):
                self.assertIn("NFC_A_PWD_AUTH_command", detections(code))
    def test_command_built_outside_the_call(self):
        # Dangerous bytes are denied wherever the container is built.
        for code in ("const cmd = new Uint8Array([0xA2, 4]);",
                     "const cmd = Uint8Array.from([162, 4]);",
                     "const cmd = [0xA2, 4];"):
            with self.subTest(code=code):
                self.assertIn("NFC_A_WRITE_command", detections(code))
        # Indirection through a variable or computed byte is not allow-listed.
        for code in ("nfcAHandler.transceive(cmd)", "transceive([...prefix, 4])",
                     "transceive([WRITE, page])", "transceive(new Uint8Array(cmd))",
                     "transceive(Uint8Array.from(bytes))"):
            with self.subTest(code=code):
                self.assertIn("transceive_not_allowlisted", detections(code))
    def test_password_auth(self):
        for code in ("transceive([0x1B, 1])", "transceive([27, 1])",
                     "transceive(Uint8Array.of(27, 1))"):
            with self.subTest(code=code):
                self.assertIn("NFC_A_PWD_AUTH_command", detections(code))
    def test_irreversible_lock_format_and_page_write(self):
        self.assertIn("irreversible_NDEF_lock", detections("handler.makeReadOnly()"))
        self.assertIn("irreversible_NDEF_lock", detections("handler['makeReadOnly']()"))
        self.assertIn("formatting", detections("handler.formatNdef()"))
        self.assertIn("raw_page_write_api", detections("h.mifareUltralightWritePage(41, bytes)"))
    def test_allowed_read_commands(self):
        for code in ("transceive([0x60])", "transceive([0x30, page])", "transceive(new Uint8Array([0x3A, 4, 39]))",
                     "transceive(Uint8Array.of(0x3C, 0))", "transceive( [ 48 , 4 ] )"):
            with self.subTest(code=code):
                self.assertFalse(detections(code))
    def test_unrelated_typed_arrays_are_not_flagged(self):
        for code in ("Ndef.text.decodePayload(new Uint8Array(record.payload))",
                     "bytesToHex(Uint8Array.from(bytes))", "const page = [0x30, 4];"):
            with self.subTest(code=code):
                self.assertFalse(detections(code))

if __name__ == "__main__":
    unittest.main()
