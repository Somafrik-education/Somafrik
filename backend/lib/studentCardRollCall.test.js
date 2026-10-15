"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveRollCallKeys,
  sealReceipt,
  openReceipt,
  dedupKeyFor,
  readContext,
  assertOperationKey,
  ROLL_CALL_ERROR,
} = require("./studentCardRollCall");

const keys = deriveRollCallKeys("unit-test-secret-with-enough-length");
const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";
const STUDENT = "33333333-3333-4333-8333-333333333333";
const claims = {
  sch: "44444444-4444-4444-8444-444444444444",
  cls: "55555555-5555-4555-8555-555555555555",
  dt: "2026-10-15",
  usr: "66666666-6666-4666-8666-666666666666",
  ses: SESSION_A,
  crd: "77777777-7777-4777-8777-777777777777",
  stu: STUDENT,
  exp: 1_900_000_000_000,
};

test("le reçu est opaque : aucun identifiant interne lisible", () => {
  const receipt = sealReceipt(keys, claims);
  assert.match(receipt, /^rc1\.[A-Za-z0-9_-]+$/);
  const decoded = Buffer.from(receipt.split(".")[1], "base64url").toString("latin1");
  for (const value of Object.values(claims)) assert.equal(decoded.includes(String(value)), false, String(value));
  assert.deepEqual(openReceipt(keys, receipt), claims);
  assert.notEqual(sealReceipt(keys, claims), receipt, "IV aléatoire : deux reçus ne sont jamais identiques");
});

test("un reçu modifié, tronqué ou signé par une autre clé est refusé", () => {
  const receipt = sealReceipt(keys, claims);
  const payload = receipt.split(".")[1];
  const flipped = `${payload.slice(0, 20)}${payload[20] === "A" ? "B" : "A"}${payload.slice(21)}`;
  assert.equal(openReceipt(keys, `rc1.${flipped}`), null);
  assert.equal(openReceipt(keys, receipt.slice(0, -4)), null);
  assert.equal(openReceipt(keys, `rc2.${payload}`), null);
  assert.equal(openReceipt(keys, `${receipt}.x`), null);
  assert.equal(openReceipt(deriveRollCallKeys("another-secret-with-enough-length"), receipt), null);
  for (const junk of [null, undefined, 42, "", "rc1.", "rc1.%%%"]) assert.equal(openReceipt(keys, junk), null);
});

test("dédup : même élève, même session → même clé ; sessions différentes → non corrélables", () => {
  assert.equal(dedupKeyFor(keys, SESSION_A, STUDENT), dedupKeyFor(keys, SESSION_A, STUDENT));
  assert.notEqual(dedupKeyFor(keys, SESSION_A, STUDENT), dedupKeyFor(keys, SESSION_B, STUDENT));
  assert.equal(dedupKeyFor(keys, SESSION_A, STUDENT).includes(STUDENT), false);
});

test("contexte strict : session UUID, classe UUID, date ISO réelle", () => {
  assert.deepEqual(readContext({ sessionId: SESSION_A.toUpperCase(), classId: claims.cls, date: "2026-10-15" }), {
    sessionId: SESSION_A, classId: claims.cls, date: "2026-10-15",
  });
  for (const bad of [
    { sessionId: "nope", classId: claims.cls, date: "2026-10-15" },
    { sessionId: SESSION_A, classId: "CL-1", date: "2026-10-15" },
    { sessionId: SESSION_A, classId: claims.cls, date: "2026-02-30" },
    { sessionId: SESSION_A, classId: claims.cls, date: "15/10/2026" },
  ]) {
    assert.throws(() => readContext(bad), { code: ROLL_CALL_ERROR.INPUT_INVALID });
  }
});

test("l'identifiant d'opération stable est la session d'appel", () => {
  assert.doesNotThrow(() => assertOperationKey(SESSION_A.toUpperCase(), SESSION_A));
  for (const key of [undefined, "", SESSION_B, "random"]) {
    assert.throws(() => assertOperationKey(key, SESSION_A), { code: ROLL_CALL_ERROR.OPERATION_KEY_REQUIRED });
  }
});
