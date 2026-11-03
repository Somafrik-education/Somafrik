"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyStudentIntegrity,
  classifyUnpaidFees,
  summarizeIntegrityCounts,
  assertReadOnlySql,
  INTEGRITY_COUNT_SQL,
  STUDENT_DIAGNOSIS_SQL,
} = require("./studentIntegrity");

const UUID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MATRICULE = "CD-IN-ME-26-00010";

test("élève actif inscrit : éligible et retrouvable", () => {
  const result = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: UUID,
    studentStatus: "active",
    hasActiveEnrollment: true,
  });
  assert.equal(result.category, "active");
  assert.equal(result.collectionEligible, true);
  assert.equal(result.historyVisible, true);
});

test("UUID et matricule désignent le même élève actif", () => {
  const byUuid = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: UUID,
    hasActiveEnrollment: true,
  });
  const byMatricule = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: MATRICULE,
    enrollmentStatus: "enrolled",
  });
  assert.equal(byUuid.category, "active");
  assert.equal(byMatricule.category, "active");
  assert.equal(byMatricule.collectionEligible, true);
});

test("élève archivé : historique consultable, pas de nouvel encaissement", () => {
  const result = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: MATRICULE,
    studentStatus: "archived",
    hasActiveEnrollment: false,
    financeRowExists: true,
  });
  assert.equal(result.category, "archived");
  assert.equal(result.collectionEligible, false);
  assert.equal(result.historyVisible, true);
});

test("élève sans inscription active : solde conservé, encaissement refusé", () => {
  const result = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: MATRICULE,
    studentStatus: "active",
    hasActiveEnrollment: false,
    financeRowExists: true,
  });
  assert.equal(result.category, "no_active_enrollment");
  assert.equal(result.collectionEligible, false);
  assert.equal(result.historyVisible, true);
});

test("changement d'année : une inscription active courante rend l'élève éligible", () => {
  const closedYearOnly = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: UUID,
    enrollmentStatus: "closed",
  });
  const currentYearEnrolled = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: UUID,
    hasActiveEnrollment: true,
  });
  assert.equal(closedYearOnly.category, "no_active_enrollment");
  assert.equal(currentYearEnrolled.category, "active");
});

test("élève inexistant : aucune opération", () => {
  const result = classifyStudentIntegrity({
    studentExists: false,
    displayedStudentId: MATRICULE,
  });
  assert.equal(result.category, "missing");
  assert.equal(result.collectionEligible, false);
  assert.equal(result.historyVisible, false);
});

test("écriture financière orpheline : signalée, jamais effacée par le classement", () => {
  const result = classifyStudentIntegrity({
    studentExists: false,
    financeRowExists: true,
    displayedStudentId: "fee-without-student",
  });
  assert.equal(result.category, "orphan_finance");
  assert.equal(result.collectionEligible, false);
  assert.equal(result.historyVisible, true);
});

test("identifiant public divergent : l'élève inscrit reste encaissable via l'UUID", () => {
  const result = classifyUnpaidFees(
    [
      {
        studentDbId: UUID,
        studentCode: MATRICULE,
        hasActiveEnrollment: true,
        studentStatus: "active",
        balance: 320000,
      },
    ],
    "profile-legacy-id",
  );
  assert.equal(result.category, "identity_mismatch");
  assert.equal(result.collectionEligible, true);
  assert.equal(result.canonicalStudentId, UUID);
  assert.equal(result.matricule, MATRICULE);
  assert.equal(result.historyVisible, true);
});

test("écart d'établissement : pas de nouvel encaissement", () => {
  const result = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: UUID,
    hasActiveEnrollment: true,
    schoolMismatch: true,
    financeRowExists: true,
  });
  assert.equal(result.category, "school_mismatch");
  assert.equal(result.collectionEligible, false);
  assert.equal(result.historyVisible, true);
});

test("les comptes d'anomalies agrègent par établissement sans identité d'élève", () => {
  const summary = summarizeIntegrityCounts([
    { school_code: "CD-IN-26-001", category: "no_active_enrollment", count: 2 },
    { school_code: "CD-IN-26-001", category: "identity_mismatch", count: 1 },
    { school_code: "CD-XX-OTH-26", category: "orphan_finance", count: 4 },
  ]);
  assert.equal(summary.schools["CD-IN-26-001"].no_active_enrollment, 2);
  assert.equal(summary.totals.orphan_finance, 4);
  assert.equal(JSON.stringify(summary).includes(MATRICULE), false);
});

test("le diagnostic SQL est en lecture seule et n'extrait pas de nom", () => {
  assertReadOnlySql(INTEGRITY_COUNT_SQL);
  assertReadOnlySql(STUDENT_DIAGNOSIS_SQL);
  assert.match(STUDENT_DIAGNOSIS_SQL, /student_code = \$1/);
  assert.match(INTEGRITY_COUNT_SQL, /GROUP BY s\.school_code/);
});
