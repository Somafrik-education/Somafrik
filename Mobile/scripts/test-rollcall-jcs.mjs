/**
 * PR2 reference parity against the actual Backend JCS implementation.
 * Node gate only — must additionally execute unchanged vectors under Hermes (S13).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(filename), "../..");
const require = createRequire(import.meta.url);
const backend = require(path.join(repoRoot, "backend/contracts/reportCard/jcs.js"));
const { canonicalize, utf8, lp, canonicalContractJson } = await import(
  pathToFileURL(path.join(repoRoot, "Mobile/src/offline/rollCall/jcs.ts")).href
);
const vectors = JSON.parse(fs.readFileSync(
  path.join(repoRoot, "docs/audits/NFC-PRES-LOCAL-PR0-vectors.json"), "utf8"
));
const hex = (bytes) => Buffer.from(bytes).toString("hex");
let assertions = 0;

for (const id of ["J-1","J-2","J-3","J-4","J-5","J-6","J-7"]) {
  const { input, canonical, sha256 } = vectors.jcs[id];
  assert.equal(canonicalize(input), backend.canonicalize(input), id + " backend");
  assert.equal(canonicalize(input), canonical, id + " oracle");
  assert.equal(
    createHash("sha256").update(utf8(canonicalize(input))).digest("hex"), sha256,
    id + " sha256 bytes",
  );
  assertions += 3;
}
const lpInputs = [
  { fields: ["a|b","c"], expected: vectors.expected["V-6_lp_a|b,c"] },
  { fields: ["a","b|c"], expected: vectors.expected["V-6_lp_a,b|c"] },
  { fields: ["ab","","c"], expected: vectors.expected["V-7_lp_ab,empty,c"] },
];
for (const v of lpInputs) {
  assert.equal(hex(lp(v.fields)), v.expected);
  assertions++;
}
for (const text of ["", "ASCII", "é", "e\u0301", "😀", "ﬁ", "\u0000", "\u007f", "漢字"]) {
  assert.equal(hex(utf8(text)), Buffer.from(text, "utf8").toString("hex"));
  assertions++;
}
for (const x of [
  undefined, NaN, Infinity, -Infinity, -0, 0.5, 9007199254740992, 1n,
  { a: undefined }, [1, undefined], [,1], "\ud800", "\udc00",
  Object.create({ injected: true }), new Date(),
]) {
  assert.throws(() => canonicalContractJson(x), "reject invalid I-JSON/contract value");
  assertions++;
}
const sample = canonicalContractJson(vectors.testSyncBodyWithoutDigest);
assert.equal(
  createHash("sha256").update(sample.bytes).digest("hex"),
  vectors.expected["V-11_payloadDigest"],
);
assertions++;

for (let i = 0; i < 120; i++) {
  const payload = {
    t: i, arr: [i % 2 === 0, null, "é", "😀"],
    nested: { b: 4, a: [1, 2, 3] },
  };
  assert.equal(canonicalize(payload), backend.canonicalize(payload));
  assert.equal(canonicalContractJson(payload).text, backend.canonicalize(payload));
  assertions += 2;
}
const source = fs.readFileSync(path.join(repoRoot, "Mobile/src/offline/rollCall/jcs.ts"), "utf8");
assert.ok(!/node:crypto|Buffer\s*[.(]/.test(source), "native module has no Node-only dependencies");
assertions++;
console.log("PASS: JCS/UTF8/LP Node parity " + assertions + " assertions; HERMES S13 NOT RUN");
