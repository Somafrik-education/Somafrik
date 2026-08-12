/**
 * Chaîne de vérification d'intégrité des données (API + règles métier).
 *
 *   npm run verify:data-integrity
 */
const assert = require("assert");
const {
  request,
  login,
  getState,
  putState,
  pushResult,
  SUPERADMIN_ID,
  SUPERADMIN_PASSWORD,
  newId,
  todayPeriodDate,
} = require("./e2e-api-helpers");
const {
  validateNoteWrite,
  validatePresenceWrite,
  validatePaymentWrite,
  validateGradeValue,
  auditFullState,
  detectDuplicateNoteKeys,
} = require("../backend/lib/dataIntegrityRules");

async function main() {
  const results = [];
  const stamp = Date.now();

  const superToken = await login(SUPERADMIN_ID, SUPERADMIN_PASSWORD);
  const state = await getState(superToken);
  const schoolCode = (state.schools ?? [])[0]?.code ?? "CD-2026-0001";
  pushResult(results, "1. État chargé", schoolCode, schoolCode, Boolean(state));

  // Règles unitaires embarquées
  pushResult(
    results,
    "2. Note > barème refusée (règle)",
    "erreur",
    validateGradeValue(21, 20) ? "erreur" : "—",
    Boolean(validateGradeValue(21, 20)),
  );

  const orphanNoteError = validateNoteWrite(state, {
    studentId: `GHOST-${stamp}`,
    evaluationId: "EVAL-UNKNOWN",
    value: 10,
    scale: 20,
  });
  pushResult(
    results,
    "3. Note orpheline refusée (règle)",
    "élève introuvable",
    orphanNoteError ?? "—",
    Boolean(orphanNoteError),
  );

  const student = (state.students ?? []).find((row) => normalizeSchool(row.schoolCode) === normalizeSchool(schoolCode));
  const evaluation = (state.evaluations ?? []).find((row) => normalizeSchool(row.schoolCode) === normalizeSchool(schoolCode));

  if (student && evaluation) {
    const crossSchoolNote = validateNoteWrite(
      {
        ...state,
        evaluations: [
          {
            ...evaluation,
            schoolCode: evaluation.schoolCode === schoolCode ? "OTHER-SCHOOL" : schoolCode,
          },
        ],
      },
      {
        studentId: student.id ?? student.matricule,
        evaluationId: evaluation.id,
        value: 12,
        scale: 20,
        schoolCode: student.schoolCode,
      },
    );
    pushResult(
      results,
      "4. Note cross-établissement refusée",
      "même établissement",
      crossSchoolNote ?? "—",
      Boolean(crossSchoolNote),
    );
  } else {
    pushResult(results, "4. Note cross-établissement refusée", "skip", "pas de données", true);
  }

  const dupNotes = detectDuplicateNoteKeys(state.notes ?? []);
  pushResult(
    results,
    "5. Audit doublons notes (état actuel)",
    "0",
    String(dupNotes.length),
    dupNotes.length === 0,
  );

  const auditIssues = auditFullState(state);
  const criticalCount = auditIssues.filter((item) => item.severity === "critical").length;
  pushResult(
    results,
    "6. Audit état — problèmes critiques",
    "0",
    String(criticalCount),
    criticalCount === 0,
  );

  // API : note orpheline (super admin ou enseignant)
  const overflowRes = await request("/notes", {
    method: "POST",
    token: superToken,
    body: {
      studentId: `GHOST-${stamp}`,
      subject: "Mathématiques",
      value: 15,
      scale: 20,
      period: "Trimestre 1",
    },
  });
  pushResult(
    results,
    "7. API refuse note élève inexistant",
    "400/404",
    String(overflowRes.status),
    overflowRes.status === 400 || overflowRes.status === 404,
  );

  // API : note > barème
  if (student) {
    const overRes = await request("/notes", {
      method: "POST",
      token: superToken,
      body: {
        studentId: student.matricule ?? student.id,
        subject: "Mathématiques",
        value: 25,
        scale: 20,
        period: "Trimestre 1",
      },
    });
    pushResult(
      results,
      "8. API refuse note > barème",
      "400",
      String(overRes.status),
      overRes.status === 400,
    );
  } else {
    pushResult(results, "8. API refuse note > barème", "skip", "pas d'élève", true);
  }

  // Présence orpheline
  const presenceOrphan = validatePresenceWrite(state, {
    studentId: `GHOST-${stamp}`,
    date: todayPeriodDate(),
    className: "1ère A",
    schoolCode,
  });
  pushResult(
    results,
    "9. Présence orpheline refusée (règle)",
    "élève introuvable",
    presenceOrphan ?? "—",
    Boolean(presenceOrphan),
  );

  // Paiement montant négatif
  const badPayment = validatePaymentWrite(state, {
    studentId: student?.id ?? `GHOST-${stamp}`,
    amount: -50,
    date: todayPeriodDate(),
    method: "Espèces",
    schoolCode,
  });
  pushResult(
    results,
    "10. Paiement négatif refusé",
    "montant positif",
    badPayment ?? "—",
    Boolean(badPayment),
  );

  // Idempotence : double POST note avec même clé
  if (student) {
    const idemKey = `idem-${stamp}`;
    const noteBody = {
      studentId: student.matricule ?? student.id,
      subject: "Mathématiques",
      value: 11,
      scale: 20,
      period: "Trimestre 1",
    };
    const first = await request("/notes", {
      method: "POST",
      token: superToken,
      headers: { "Idempotency-Key": idemKey },
      body: noteBody,
    });
    const second = await request("/notes", {
      method: "POST",
      token: superToken,
      headers: { "Idempotency-Key": idemKey },
      body: noteBody,
    });
    pushResult(
      results,
      "11. Idempotence note (rejeu)",
      "201 + replay",
      `${first.status}/${second.status}`,
      (first.status === 201 || first.status === 200) &&
        second.status === (first.status === 201 ? 201 : 200) &&
        Boolean(second.body?.idempotentReplay),
    );
  } else {
    pushResult(results, "11. Idempotence note (rejeu)", "skip", "pas d'élève", true);
  }

  // Validation import élèves
  const importRes = await request("/backoffice/import/students/validate", {
    method: "POST",
    token: superToken,
    body: {
      rows: [
        { Nom: "Test", Prénom: "Import", "Code établissement": schoolCode, Classe: "1ère A" },
        { Nom: "", Prénom: "Sans nom" },
      ],
    },
  });
  pushResult(
    results,
    "12. Validation import élèves",
    "200 + rapport",
    String(importRes.status),
    importRes.status === 200 &&
      typeof importRes.body?.summary?.accepted === "number" &&
      importRes.body.summary.rejected >= 1,
  );

  const orphanStudentRes = await request("/backoffice/state", {
    method: "PUT",
    token: superToken,
    body: {
      students: [
        {
          id: `STUDENTS-ORPHAN-${stamp}`,
          firstName: "Orphelin",
          lastName: "API",
          schoolCode,
          className: "1ère A",
          matricule: `ORPHAN-${stamp}`,
        },
      ],
    },
  });
  pushResult(
    results,
    "13. API refuse écriture élèves legacy via state (PR2)",
    "400",
    String(orphanStudentRes.status),
    orphanStudentRes.status === 400,
  );

  console.log("\n=== Vérification intégrité données ===\n");
  console.table(results);
  const failures = results.filter((row) => !row.OK);
  if (failures.length) {
    console.error("Échecs:", JSON.stringify(failures, null, 2));
    process.exit(1);
  }
  console.log("Intégrité données : OK");
}

function normalizeSchool(value) {
  return String(value ?? "").trim().toUpperCase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
