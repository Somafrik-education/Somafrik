"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ENTRY_ERROR,
  ENTRY_SCAN_ROLE_KEYS,
  ENTRY_READ_ROLE_KEYS,
  readEntryPayload,
  assertEntryOperationKey,
  assertEntryActor,
  recordEntryScan,
} = require("./studentCardEntry");
const { liveSchoolActor } = require("./liveSchoolRoleKeys");

const OP = "3f0c2a8e-6b1d-4c7e-9a2b-1d2e3f4a5b6c";

function code(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

test("charge utile : carte, mode nfc|qr et identifiant d'opération UUID obligatoires", () => {
  assert.deepEqual(readEntryPayload({ cardToken: " t ", medium: "NFC", operationId: OP.toUpperCase() }),
    { cardToken: "t", medium: "nfc", operationId: OP });
  for (const bad of [
    {}, { cardToken: "t", medium: "bluetooth", operationId: OP }, { cardToken: "t", medium: "qr", operationId: "1" },
    { cardToken: "x".repeat(513), medium: "qr", operationId: OP }, { cardToken: 42, medium: "qr", operationId: OP },
  ]) {
    assert.equal(code(() => readEntryPayload(bad)), ENTRY_ERROR.INPUT_INVALID, JSON.stringify(bad).slice(0, 60));
  }
});

test("Idempotency-Key = identifiant d'opération", () => {
  assert.equal(code(() => assertEntryOperationKey(OP.toUpperCase(), OP)), null);
  assert.equal(code(() => assertEntryOperationKey(undefined, OP)), ENTRY_ERROR.INPUT_INVALID);
  assert.equal(code(() => assertEntryOperationKey("autre", OP)), ENTRY_ERROR.INPUT_INVALID);
});

test("rôles : direction et secrétariat scannent ; Admin School consulte ; aucun élargissement", () => {
  for (const key of ["PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SECRETARY"]) {
    assert.equal(code(() => assertEntryActor([key], ENTRY_SCAN_ROLE_KEYS)), null, key);
  }
  assert.equal(code(() => assertEntryActor(["SCHOOL_ADMIN"], ENTRY_READ_ROLE_KEYS)), null);
  for (const keys of [["SCHOOL_ADMIN"], ["SUPERVISOR"], ["TEACHER"], ["ACCOUNTANT"], [], ["PARENT"], ["SUPER_ADMIN"],
    ["COUNTRY_ADMIN"], ["INVENTE"], ["SECRETARY", "PARENT"], ["PRINCIPAL", "SUPER_ADMIN"]]) {
    assert.equal(code(() => assertEntryActor(keys, ENTRY_SCAN_ROLE_KEYS)), ENTRY_ERROR.ROLE_FORBIDDEN, keys.join("+"));
  }
  assert.equal(code(() => assertEntryActor(["SECRETARY", "TEACHER"], ENTRY_SCAN_ROLE_KEYS)), null, "multi-rôle");
  for (const keys of [["SUPERVISOR"], ["TEACHER"]]) {
    assert.equal(code(() => assertEntryActor(keys, ENTRY_READ_ROLE_KEYS)), ENTRY_ERROR.ROLE_FORBIDDEN, keys.join("+"));
  }
});

test("rôles relus en base : clés du JWT ignorées, fail-closed sans primitive", async () => {
  const principal = { sub: "u1", roleKeys: ["PRINCIPAL"] };
  assert.deepEqual(await liveSchoolActor({}, principal, "s1"), { userId: "u1", roleKeys: [] });
  const repo = {
    resolveCanonicalUserIdForSchool: async () => "canon",
    listActiveUserRoleKeysForSchool: async (userId) => (userId === "canon" ? ["teacher", "SECRETARY", "teacher"] : []),
  };
  assert.deepEqual(await liveSchoolActor(repo, principal, "s1"), { userId: "canon", roleKeys: ["SECRETARY", "TEACHER"] });
});

test("refus de rôle avant toute lecture de carte ou écriture", async () => {
  let touched = false;
  const repo = {
    listActiveUserRoleKeysForSchool: async () => ["SUPERVISOR"],
    one: async () => {
      touched = true;
      return null;
    },
  };
  await assert.rejects(
    recordEntryScan(repo, { cardToken: "t", medium: "qr", operationId: OP }, { schoolId: "s1" }, { sub: "u" }),
    (error) => error.code === ENTRY_ERROR.ROLE_FORBIDDEN,
  );
  assert.equal(touched, false);
});
