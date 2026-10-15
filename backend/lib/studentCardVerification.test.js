"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isClassRestricted, verifyStudentCard } = require("./studentCardVerification");

test("restriction aux classes : roleKey canonique TEACHER, quel que soit le libellé", () => {
  assert.equal(isClassRestricted({ roleKeys: ["TEACHER"], role: "Professeur principal" }), true);
  assert.equal(isClassRestricted({ roleKeys: ["teacher", "PARENT"], role: "Directeur" }), true, "aucune élévation par rôle secondaire ou libellé");
  assert.equal(isClassRestricted({ roleKeys: [], role: "Enseignant" }), false, "un libellé seul ne définit jamais un périmètre");
  assert.equal(isClassRestricted({ roleKeys: ["PRINCIPAL"], role: "Enseignant" }), false, "un libellé ne modifie pas les décisions basées sur roleKey");
  assert.equal(isClassRestricted({ roleKeys: ["PRINCIPAL"], role: "Directeur" }), false);
});

test("parents et élèves sont refusés avant toute lecture de carte", async () => {
  let reads = 0;
  const repo = new Proxy({}, { get: () => () => { reads += 1; return null; } });
  for (const principal of [
    { roleKeys: ["PARENT"], role: "Parent" },
    { roleKeys: ["STUDENT"], role: "Élève / Étudiant" },
    { roleKeys: [], role: "Parent" },
    { roleKeys: [], role: "Directeur" },
    { role: "Enseignant" },
    { roleKeys: ["UNKNOWN_ROLE"], role: "Directeur" },
    { roleKeys: ["TEACHER", "UNKNOWN_ROLE"], role: "Enseignant" },
    { roleKeys: ["SUPER_ADMIN", "PRINCIPAL"], role: "Directeur" },
    { roleKeys: ["COUNTRY_ADMIN"], role: "Admin Pays" },
  ]) {
    await assert.rejects(
      verifyStudentCard(repo, { cardToken: "a.b" }, { schoolId: "s" }, principal, async () => true),
      { statusCode: 403, code: "CARD_VERIFY_FORBIDDEN" },
    );
  }
  assert.equal(reads, 0);
});

test("catalogue canonique : les rôles du personnel connus sont acceptés sans utiliser le libellé", async () => {
  // Le contrôle du personnel doit réussir AVANT le refus simulé par la résolution de carte.
  for (const principal of [
    { roleKey: "TEACHER", role: "Professeur principal" },
    { roleKeys: ["PRINCIPAL"], role: "Directeur" },
    { roleKeys: ["SCHOOL_ADMIN"], role: "Directeur" },
    { roleKeys: ["PARENT", "TEACHER"], role: "Parent" },
    { roleKeys: ["ACCOUNTANT"], role: "Comptable" },
  ]) {
    let reads = 0;
    const repo = {};
    // Le contrôle de carte doit être atteint : ce stub provoque une erreur d'identité,
    // mais pas le 403 d'interdiction au personnel.
    await assert.rejects(
      verifyStudentCard(repo, { cardToken: "a.b" }, { schoolId: "s" }, principal, async () => true),
      (error) => {
        reads += 1;
        assert.notEqual(error.code, "CARD_VERIFY_FORBIDDEN");
        return true;
      },
    );
    assert.equal(reads, 1);
  }
});
