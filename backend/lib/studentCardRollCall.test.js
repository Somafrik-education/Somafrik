"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveRollCallKeys,
  sealReceipt,
  openReceipt,
  dedupKeyFor,
  readContext,
  readReceipts,
  assertCardsStillValid,
  assertOperationKey,
  authorizeRollCallActor,
  readJustification,
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

const CARD_A = claims.crd;
const CARD_B = "88888888-8888-4888-8888-888888888888";
const SCOPE = { schoolId: claims.sch };
const CONTEXT = { sessionId: SESSION_A, classId: claims.cls, date: claims.dt };

test("revalide chaque carte distincte du même élève avant déduplication, dans les deux ordres", async () => {
  const valid = sealReceipt(keys, claims);
  const revoked = sealReceipt(keys, { ...claims, crd: CARD_B });
  for (const [order, invalidIndex] of [
    [[valid, revoked], 1],
    [[revoked, valid], 0],
  ]) {
    const parsed = readReceipts({ receipts: order }, keys, CONTEXT, SCOPE, claims.usr, 1_800_000_000_000);
    assert.equal(parsed.entries.length, 1, "une seule écriture de présence prévue");
    assert.equal(parsed.cardEntries.length, 2, "les deux cartes doivent être revérifiées");
    let writes = 0;
    const repo = {
      all: async (_query, args) => {
        assert.equal(args[1].length, 2, "aucune carte ignorée");
        return [
          { id: CARD_A, student_id: STUDENT, status: "active", nfc_encoding_state: null },
          { id: CARD_B, student_id: STUDENT, status: "revoked", nfc_encoding_state: null },
        ];
      },
      upsertSchoolAttendanceBatch: async () => { writes += 1; },
    };
    await assert.rejects(assertCardsStillValid(repo, SCOPE.schoolId, parsed.cardEntries), (error) => {
      assert.equal(error.code, ROLL_CALL_ERROR.CARD_INVALID);
      assert.deepEqual(error.details.invalidReceiptIndexes, [invalidIndex]);
      return true;
    });
    assert.equal(writes, 0, "aucune présence écrite sur échec de revérification");
  }
});

test("deux reçus de la même carte restent un seul contrôle et une seule présence", async () => {
  const receipts = [sealReceipt(keys, claims), sealReceipt(keys, claims)];
  const parsed = readReceipts({ receipts }, keys, CONTEXT, SCOPE, claims.usr, 1_800_000_000_000);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.cardEntries.length, 1);
  assert.deepEqual(parsed.cardEntries[0].indexes, [0, 1]);
  await assertCardsStillValid({ all: async () => [{
    id: CARD_A, student_id: STUDENT, status: "active", nfc_encoding_state: null,
  }] }, SCOPE.schoolId, parsed.cardEntries);
});

test("CARTE-UX-ROLE-01 : parcours décidés sur les clés canoniques et la permission effective, jamais sur le libellé", () => {
  const allowed = (principal, mode) => { try { authorizeRollCallActor(principal, mode); return true; } catch (error) {
    assert.equal(error.code, ROLL_CALL_ERROR.ROLE_FORBIDDEN); assert.equal(error.statusCode, 403); return false; } };
  const update = ["Présences:CREATE", "Présences:UPDATE"];
  assert.equal(allowed({ roleKeys: ["TEACHER"] }, "teacher"), true);
  assert.equal(allowed({ roleKeys: ["PRINCIPAL", "TEACHER"], role: "Directeur" }, "teacher"), true, "multi-rôle : parcours enseignant possible");
  for (const key of ["PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SCHOOL_ADMIN"]) {
    assert.equal(allowed({ roleKeys: [key], permissions: update }, "direction"), true, key);
    assert.equal(allowed({ roleKeys: [key], permissions: update }, "teacher"), false, `${key} ne pointe jamais comme enseignant`);
    assert.equal(allowed({ roleKeys: [key], permissions: ["Présences:CREATE"] }, "direction"), false, `${key} sans UPDATE effective`);
  }
  for (const key of ["SUPERVISOR", "SECRETARY", "ACCOUNTANT", "PARENT", "STUDENT"]) {
    assert.equal(allowed({ roleKeys: [key], permissions: update }, "direction"), false, key);
    assert.equal(allowed({ roleKeys: [key], permissions: update }, "teacher"), false, key);
  }
  assert.equal(allowed({ role: "Enseignant", permissions: update }, "teacher"), false, "libellé seul refusé");
  assert.equal(allowed({ role: "Directeur", permissions: update }, "direction"), false, "libellé seul refusé");
  assert.equal(allowed({ roleKeys: ["DIRECTEUR_CUSTOM"], permissions: update }, "direction"), false, "clé inconnue refusée");
  assert.equal(allowed({ roleKeys: ["TEACHER", "SUPER_ADMIN"] }, "teacher"), false, "rôle plateforme exclu");
  assert.equal(allowed({ roleKeys: ["PRINCIPAL", "COUNTRY_ADMIN"], permissions: update }, "direction"), false);
});

test("CARTE-UX-ROLE-01 : justification obligatoire, normalisée et bornée", () => {
  for (const bad of [undefined, "", "   ", "court", "x".repeat(501), "Absence de l'enseignant\u0007 ce jour"]) {
    assert.throws(() => readJustification({ justification: bad }), { code: ROLL_CALL_ERROR.JUSTIFICATION_REQUIRED });
  }
  assert.equal(readJustification({ justification: "  Enseignant   absent,\n appel direction " }), "Enseignant absent, appel direction");
  assert.equal(readJustification({ justification: "x".repeat(500) }).length, 500);
});

test("CARTE-UX-ROLE-01 : un reçu ne sert que dans son parcours", () => {
  const live = { ...claims, exp: Date.now() + 60_000 };
  const teacherReceipt = sealReceipt(keys, { ...live, mod: "teacher" });
  const directionReceipt = sealReceipt(keys, { ...live, mod: "direction" });
  const read = (receipt, mode) => readReceipts({ receipts: [receipt] }, keys, CONTEXT, SCOPE, claims.usr, Date.now(), mode);
  assert.equal(read(teacherReceipt, "teacher").entries.length, 1);
  assert.equal(read(directionReceipt, "direction").entries.length, 1);
  assert.throws(() => read(teacherReceipt, "direction"), { code: ROLL_CALL_ERROR.CONTEXT_MISMATCH });
  assert.throws(() => read(directionReceipt, "teacher"), { code: ROLL_CALL_ERROR.CONTEXT_MISMATCH });
});
