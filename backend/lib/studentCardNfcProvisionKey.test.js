"use strict";

/** CARTE-FIX-QR-NFC — clé dédiée, défi signé et fail-closed du provisionnement NFC. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  PROVISION_TTL_MS,
  resolveNfcProvisionKey,
  signProvisionChallenge,
  verifyProvisionChallenge,
} = require("./studentCardNfcProvisionKey");
const { beginStudentCardNfcProvision, confirmStudentCardNfcProvision } = require("./studentCardsNfcLifecycle");

const STRONG = "a".repeat(20) + "-strong-secret-for-tests";
const OTHER = "b".repeat(20) + "-dedicated-secret-for-tests";

function expectUnavailable(fn) {
  assert.throws(fn, (error) => error.statusCode === 503 && error.code === "STUDENT_CARD_NFC_PROVISION_UNAVAILABLE");
}

test("secret serveur absent, court ou connu comme faible : provisionnement indisponible (503)", () => {
  expectUnavailable(() => resolveNfcProvisionKey({}));
  expectUnavailable(() => resolveNfcProvisionKey({ JWT_SECRET: "trop-court" }));
  expectUnavailable(() => resolveNfcProvisionKey({ JWT_SECRET: "somafrik-dev-secret-change-me" }));
  expectUnavailable(() => resolveNfcProvisionKey({ JWT_SECRET: "change-this-long-random-secret-before-use" }));
  assert.equal(resolveNfcProvisionKey({ JWT_SECRET: STRONG }).source, "derived");
});

test("clé dédiée prioritaire, indépendante de JWT_SECRET ; jamais de repli si elle est invalide", () => {
  const derived = resolveNfcProvisionKey({ JWT_SECRET: STRONG });
  const dedicated = resolveNfcProvisionKey({ JWT_SECRET: STRONG, STUDENT_CARD_NFC_PROVISION_SECRET: OTHER });
  assert.equal(dedicated.source, "dedicated");
  assert.notDeepEqual(dedicated.key, derived.key);
  // La clé dérivée n'est pas JWT_SECRET lui-même (séparation de domaine).
  assert.notDeepEqual(derived.key, Buffer.from(STRONG));
  expectUnavailable(() => resolveNfcProvisionKey({ JWT_SECRET: STRONG, STUDENT_CARD_NFC_PROVISION_SECRET: "court" }));
  expectUnavailable(() => resolveNfcProvisionKey({ JWT_SECRET: STRONG, STUDENT_CARD_NFC_PROVISION_SECRET: STRONG }));
  expectUnavailable(() => resolveNfcProvisionKey({ STUDENT_CARD_NFC_PROVISION_SECRET: "somafrik-dev-secret-change-me" }));
  assert.equal(resolveNfcProvisionKey({ STUDENT_CARD_NFC_PROVISION_SECRET: OTHER }).source, "dedicated");
});

test("défi : valide une fois signé, refusé s'il est expiré, trop lointain, altéré ou lié à d'autres paramètres", () => {
  const { key } = resolveNfcProvisionKey({ JWT_SECRET: STRONG });
  const fields = { cardId: "c1", tokenHash: "f".repeat(64), uid: "04A1B2C3D4E5F6", tagType: "NTAG213", operationId: "op-1", actorId: "user-1" };
  const now = 1_800_000_000_000;
  const challenge = signProvisionChallenge(fields, now + PROVISION_TTL_MS, key);
  assert.equal(verifyProvisionChallenge(challenge, fields, key, now), true);
  // Expiration : à l'échéance et après.
  assert.equal(verifyProvisionChallenge(challenge, fields, key, now + PROVISION_TTL_MS), false);
  assert.equal(verifyProvisionChallenge(challenge, fields, key, now + PROVISION_TTL_MS + 1), false);
  // Échéance au-delà de la durée autorisée : refus même correctement signée.
  assert.equal(verifyProvisionChallenge(signProvisionChallenge(fields, now + PROVISION_TTL_MS + 60_000, key), fields, key, now), false);
  // Changement d'utilisateur, de puce, d'opération, de carte ou de secret de carte : refus.
  for (const change of [{ actorId: "user-2" }, { uid: "04FFFFFFFFFFFF" }, { operationId: "op-2" }, { cardId: "c2" }, { tokenHash: "e".repeat(64) }, { tagType: "NTAG216" }]) {
    assert.equal(verifyProvisionChallenge(challenge, { ...fields, ...change }, key, now), false, JSON.stringify(change));
  }
  // Autre clé serveur (rotation) : refus.
  const rotated = resolveNfcProvisionKey({ JWT_SECRET: STRONG, STUDENT_CARD_NFC_PROVISION_SECRET: OTHER }).key;
  assert.equal(verifyProvisionChallenge(challenge, fields, rotated, now), false);
  for (const bad of [undefined, "", "abc", `${now}.short`, challenge.slice(0, -1) + (challenge.endsWith("A") ? "B" : "A")]) {
    assert.equal(verifyProvisionChallenge(bad, fields, key, now), false, String(bad));
  }
});

test("routes de provisionnement : secret serveur invalide → 503 avant toute transaction", async () => {
  const saved = { JWT_SECRET: process.env.JWT_SECRET, DEDICATED: process.env.STUDENT_CARD_NFC_PROVISION_SECRET };
  const repo = {
    query: async () => { throw new Error("aucune requête attendue"); },
    recordAudit: async () => { throw new Error("aucun audit attendu"); },
    withTransaction: async () => { throw new Error("aucune transaction attendue"); },
  };
  const principal = { sub: "user-1", permissions: ["Élèves:UPDATE"], enrollmentSchoolId: "school-1", roleKeys: ["SCHOOL_ADMIN"] };
  const scope = { schoolId: "school-1", loginCode: "CD-T" };
  const payload = {
    cardToken: `${"A".repeat(22)}.${"B".repeat(43)}`,
    nfc: { uid: "04A1B2C3D4E5F6", tagType: "NTAG213" },
    operationId: "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    challenge: `${Date.now() + 60_000}.${"x".repeat(43)}`,
  };
  try {
    for (const env of [{ JWT_SECRET: undefined }, { JWT_SECRET: "court" }, { JWT_SECRET: STRONG, DEDICATED: "court" }]) {
      if (env.JWT_SECRET === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = env.JWT_SECRET;
      if (env.DEDICATED === undefined) delete process.env.STUDENT_CARD_NFC_PROVISION_SECRET;
      else process.env.STUDENT_CARD_NFC_PROVISION_SECRET = env.DEDICATED;
      for (const run of [beginStudentCardNfcProvision, confirmStudentCardNfcProvision]) {
        await assert.rejects(run(repo, "card-1", payload, principal, {}, scope), { statusCode: 503, code: "STUDENT_CARD_NFC_PROVISION_UNAVAILABLE" });
      }
    }
  } finally {
    if (saved.JWT_SECRET === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = saved.JWT_SECRET;
    if (saved.DEDICATED === undefined) delete process.env.STUDENT_CARD_NFC_PROVISION_SECRET;
    else process.env.STUDENT_CARD_NFC_PROVISION_SECRET = saved.DEDICATED;
  }
});
