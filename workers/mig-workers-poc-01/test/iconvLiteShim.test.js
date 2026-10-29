import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const iconv = require("../src/iconvLiteShim.cjs");

test("shim UTF-8 — accentuation", () => {
  const text = "Élève — année scolaire";
  const encoded = iconv.encode(text, "utf-8");
  assert.deepEqual(encoded, Buffer.from(text, "utf8"));
  assert.equal(iconv.decode(encoded, "utf-8"), text);
  assert.equal(iconv.getEncoder("utf-8").write(text).toString("utf8"), text);
});

test("shim UTF-8 — décodage en plusieurs fragments", () => {
  const text = "élève";
  const bytes = Buffer.from(text, "utf8");
  const decoder = iconv.getDecoder("utf-8");
  assert.equal(decoder.write(bytes.subarray(0, 1)), "");
  assert.equal(decoder.write(bytes.subarray(1, 3)), "él");
  assert.equal(decoder.write(bytes.subarray(3)), "ève");
  assert.equal(decoder.end(), "");
});

test("shim UTF-8 — encodage non pris en charge", () => {
  for (const encoding of ["latin1", "iso-8859-1", "windows-1252", "utf-16le", ""]) {
    assert.equal(iconv.encodingExists(encoding), false);
    assert.throws(() => iconv.decode(Buffer.from("a"), encoding), /Encoding not recognized/);
    assert.throws(() => iconv.getDecoder(encoding), /Encoding not recognized/);
    assert.throws(() => iconv.encode("a", encoding), /Encoding not recognized/);
  }
});

test("shim UTF-8 — rejet fail-closed", () => {
  assert.throws(() => iconv.decode(Buffer.from([0xff]), "utf-8"), /Encoding not recognized/);
  assert.throws(() => iconv.decode(Buffer.from([0xc3]), "utf-8"), /Encoding not recognized/);
  const decoder = iconv.getDecoder("utf-8");
  assert.throws(() => decoder.write(Buffer.from([0xc3, 0x28])), /Encoding not recognized/);
  const split = iconv.getDecoder("utf-8");
  assert.equal(split.write(Buffer.from([0xc3])), "");
  assert.throws(() => split.end(), /Encoding not recognized/);
  assert.throws(() => iconv.encode("café", "us-ascii"), /Encoding not recognized/);
  assert.throws(() => iconv.decode(Buffer.from([0xc3, 0xa9]), "ascii"), /Encoding not recognized/);
  assert.throws(() => iconv.encode("\uD800", "utf-8"), /Encoding not recognized/);
});
