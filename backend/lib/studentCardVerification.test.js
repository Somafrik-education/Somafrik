"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isClassRestricted, verifyStudentCard } = require("./studentCardVerification");

test("restriction aux classes : roleKey canonique TEACHER, quel que soit le libellé", () => {
  assert.equal(isClassRestricted({ roleKeys: ["TEACHER"], role: "Professeur principal" }), true);
  assert.equal(isClassRestricted({ roleKeys: ["teacher", "PARENT"], role: "Directeur" }), true, "aucune élévation par rôle secondaire ou libellé");
  assert.equal(isClassRestricted({ roleKeys: [], role: "Enseignant" }), true, "libellé : seulement plus restrictif");
  assert.equal(isClassRestricted({ roleKeys: ["PRINCIPAL"], role: "Enseignant" }), true);
  assert.equal(isClassRestricted({ roleKeys: ["PRINCIPAL"], role: "Directeur" }), false);
});

test("parents et élèves sont refusés avant toute lecture de carte", async () => {
  let reads = 0;
  const repo = new Proxy({}, { get: () => () => { reads += 1; return null; } });
  for (const principal of [
    { roleKeys: ["PARENT"], role: "Parent" },
    { roleKeys: ["STUDENT"], role: "Élève / Étudiant" },
    { roleKeys: [], role: "Parent" },
  ]) {
    await assert.rejects(
      verifyStudentCard(repo, { cardToken: "a.b" }, { schoolId: "s" }, principal, async () => true),
      { statusCode: 403, code: "CARD_VERIFY_FORBIDDEN" },
    );
  }
  assert.equal(reads, 0);
});
