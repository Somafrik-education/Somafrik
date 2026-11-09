"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyStudentIntegrity,
  classifyUnpaidFees,
  summarizeIntegrityCounts,
  assertReadOnlySql,
  canReadStudentIntegrityDiagnostic,
  diagnosticAccessDecision,
  projectOrphanObligations,
  resolveCanonicalStudentDbId,
  INTEGRITY_COUNT_SQL,
  ORPHAN_OBLIGATION_SQL,
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

test("inscription undefined, nulle ou inconnue : fail-closed, solde toujours classé consultable", () => {
  for (const hasActiveEnrollment of [undefined, null]) {
    const result = classifyUnpaidFees(
      [{ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment, balance: 320000 }],
      MATRICULE,
    );
    assert.equal(result.collectionEligible, false);
    assert.equal(result.category, "no_active_enrollment");
    assert.equal(result.canonicalStudentId, UUID);
    assert.equal(result.historyVisible, true);
  }
  const unknown = classifyStudentIntegrity({
    studentExists: true,
    studentUuid: UUID,
    matricule: MATRICULE,
    displayedStudentId: UUID,
    enrollmentStatus: "unknown",
    financeRowExists: true,
  });
  assert.equal(unknown.collectionEligible, false);
  assert.equal(unknown.category, "no_active_enrollment");
  assert.equal(unknown.historyVisible, true);
});

test("contrat CTO : UUID confirmé, établissement correspondant et inscription active", () => {
  const balance = 320000;
  const profile = "profile-legacy-id";
  const fee = (overrides) => ({ balance, amountDue: balance, ...overrides });

  const matriculeOnly = classifyUnpaidFees(
    [fee({
      studentId: profile,
      studentDbId: MATRICULE,
      canonicalStudentId: MATRICULE,
      studentCode: MATRICULE,
      studentExists: true,
      hasActiveEnrollment: true,
      studentStatus: "active",
    })],
    profile,
  );
  assert.equal(matriculeOnly.collectionEligible, false);
  assert.equal(matriculeOnly.category, "unverified_identity");
  assert.equal(matriculeOnly.canonicalStudentId, "");
  assert.notEqual(matriculeOnly.canonicalStudentId, MATRICULE);
  assert.notEqual(matriculeOnly.canonicalStudentId, profile);
  assert.equal(matriculeOnly.historyVisible, true);
  assert.equal(matriculeOnly.matricule, MATRICULE);

  const provedByMatricule = classifyStudentIntegrity({
    studentExists: true,
    matricule: MATRICULE,
    displayedStudentId: MATRICULE,
    hasActiveEnrollment: true,
    financeRowExists: true,
    studentStatus: "active",
  });
  assert.equal(provedByMatricule.category, "unverified_identity");
  assert.equal(provedByMatricule.collectionEligible, false);
  assert.equal(provedByMatricule.historyVisible, true);

  const inactive = classifyUnpaidFees(
    [fee({ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: false, studentStatus: "active" })],
    UUID,
  );
  assert.equal(inactive.collectionEligible, false);
  assert.equal(inactive.category, "no_active_enrollment");
  assert.equal(inactive.canonicalStudentId, UUID);
  assert.equal(inactive.historyVisible, true);

  const active = classifyUnpaidFees(
    [fee({ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: true, studentStatus: "active" })],
    UUID,
  );
  assert.equal(active.collectionEligible, true);
  assert.equal(active.category, "active");
  assert.equal(active.canonicalStudentId, UUID);
  assert.equal(active.historyVisible, true);

  const divergent = classifyUnpaidFees(
    [fee({
      studentId: profile,
      studentDbId: UUID,
      canonicalStudentId: UUID,
      studentCode: MATRICULE,
      hasActiveEnrollment: true,
    })],
    profile,
  );
  assert.equal(divergent.collectionEligible, true);
  assert.equal(divergent.category, "identity_mismatch");
  assert.equal(divergent.canonicalStudentId, UUID);
  assert.notEqual(divergent.canonicalStudentId, profile);
  assert.equal(divergent.historyVisible, true);

  const otherSchool = classifyUnpaidFees(
    [fee({ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: true, schoolMismatch: true })],
    UUID,
  );
  assert.equal(otherSchool.collectionEligible, false);
  assert.equal(otherSchool.category, "school_mismatch");
  assert.equal(otherSchool.canonicalStudentId, UUID);
  assert.equal(otherSchool.historyVisible, true);

  for (const result of [matriculeOnly, inactive, active, divergent, otherSchool]) {
    assert.equal(result.historyVisible, true);
    assert.equal(balance, 320000);
  }
});

test("matricule présent sans UUID canonique : historique conservé, encaissement refusé", () => {
  const result = classifyUnpaidFees(
    [
      {
        studentCode: MATRICULE,
        hasActiveEnrollment: true,
        studentStatus: "active",
        balance: 320000,
      },
    ],
    MATRICULE,
  );
  assert.equal(result.collectionEligible, false);
  assert.equal(result.category, "unverified_identity");
  assert.equal(result.canonicalStudentId, "");
  assert.equal(result.matricule, MATRICULE);
  assert.equal(result.historyVisible, true);
  assert.equal(resolveCanonicalStudentDbId({ studentCode: MATRICULE, publicId: MATRICULE, id: MATRICULE }), "");
  assert.equal(resolveCanonicalStudentDbId({ dbId: MATRICULE, studentCode: MATRICULE }), "");
  assert.equal(resolveCanonicalStudentDbId({ dbId: UUID, studentCode: MATRICULE }), UUID);
  assert.equal(
    resolveCanonicalStudentDbId({
      id: MATRICULE,
      publicId: MATRICULE,
      studentCode: MATRICULE,
      studentUuid: `stu-${MATRICULE}`,
    }),
    `stu-${MATRICULE}`,
  );
  assert.equal(
    resolveCanonicalStudentDbId({ id: "profile-legacy", publicId: "profile-legacy", studentCode: MATRICULE }),
    "",
  );
  assert.equal(
    resolveCanonicalStudentDbId({
      id: "stu-solo",
      publicId: "CD-2026-0001-STU-SOLO",
      studentCode: "CD-2026-0001-STU-SOLO",
    }),
    "stu-solo",
  );
});

test("identité absente : un identifiant de profil n'est jamais un UUID canonique", () => {
  const result = classifyUnpaidFees(
    [{ studentDbId: "profile-legacy", canonicalStudentId: "profile-legacy", balance: 320000, hasActiveEnrollment: true }],
    "profile-legacy",
  );
  assert.equal(result.canonicalStudentId, "");
  assert.notEqual(result.canonicalStudentId, "profile-legacy");
  assert.equal(result.collectionEligible, false);
  assert.equal(result.category, "orphan_finance");
  assert.equal(result.historyVisible, true);
});

test("établissement divergent sur les frais : encaissement refusé, UUID conservé", () => {
  const result = classifyUnpaidFees(
    [{ studentDbId: UUID, studentCode: MATRICULE, hasActiveEnrollment: true, schoolMismatch: true, balance: 320000 }],
    MATRICULE,
  );
  assert.equal(result.category, "school_mismatch");
  assert.equal(result.collectionEligible, false);
  assert.equal(result.canonicalStudentId, UUID);
  assert.equal(result.historyVisible, true);
});

test("une obligation orpheline reste consultable par un diagnostic autorisé, sans nom", () => {
  assert.equal(canReadStudentIntegrityDiagnostic({ permissions: ["Impayés:READ"] }), true);
  assert.equal(canReadStudentIntegrityDiagnostic({ permissions: ["Paiements:READ"] }), true);
  assert.equal(canReadStudentIntegrityDiagnostic({ permissions: ["Présences:READ"] }), false);
  assert.equal(diagnosticAccessDecision(null).allowed, true);
  assert.equal(diagnosticAccessDecision({ permissions: ["Présences:READ"] }).allowed, false);
  const projected = projectOrphanObligations([
    {
      obligation_id: "obl-orphan",
      school_code: "CD-IN-26-001",
      student_id: UUID,
      balance: 320000,
      currency: "CDF",
      status: "En retard",
      first_name: "Elie",
      last_name: "Muco",
    },
  ]);
  assert.equal(projected[0].obligationId, "obl-orphan");
  assert.equal(projected[0].balance, 320000);
  assert.equal(JSON.stringify(projected).includes("Elie"), false);
  assert.equal(JSON.stringify(projected).includes("Muco"), false);
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
  assertReadOnlySql(ORPHAN_OBLIGATION_SQL);
  assertReadOnlySql(STUDENT_DIAGNOSIS_SQL);
  assert.match(STUDENT_DIAGNOSIS_SQL, /student_code = \$1/);
  assert.match(INTEGRITY_COUNT_SQL, /LEFT JOIN schools/);
  assert.match(ORPHAN_OBLIGATION_SQL, /LEFT JOIN students/);
  assert.match(ORPHAN_OBLIGATION_SQL, /st\.id IS NULL/);
});
