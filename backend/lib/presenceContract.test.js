/**
 * D3.5b — Contrat présences : unicité école+élève+jour, sémantique Justifié.
 */
const assert = require("assert");
const { validatePresenceWrite, normalizePresenceDay } = require("./dataIntegrityRules");

function run() {
  const state = {
    students: [
      {
        id: "STU-1",
        matricule: "MAT-1",
        schoolCode: "SCH-001",
        className: "6ème A",
        schoolStatus: "Inscrit",
      },
    ],
    presences: [
      {
        id: "PRE-1",
        studentId: "STU-1",
        schoolCode: "SCH-001",
        className: "6ème A",
        date: "23-07-2026",
        status: "Présent",
      },
    ],
  };

  const sameDay = validatePresenceWrite(state, {
    studentId: "MAT-1",
    schoolCode: "SCH-001",
    className: "6ème A",
    date: "23-07-2026",
    status: "Absent",
  });
  assert.ok(
    sameDay && sameDay.includes("existe déjà"),
    "unicité établissement + élève + jour = doublon",
  );

  // La cohérence classe reste une règle d'écriture distincte de l'unicité.
  const wrongClass = validatePresenceWrite(state, {
    studentId: "STU-1",
    schoolCode: "SCH-001",
    className: "6ème B",
    date: "24-07-2026",
    status: "Absent",
  });
  assert.ok(wrongClass && wrongClass.includes("classe"), "classe incohérente refusée");

  const otherDay = validatePresenceWrite(state, {
    studentId: "STU-1",
    schoolCode: "SCH-001",
    className: "6ème A",
    date: "24-07-2026",
    status: "Justifié",
  });
  assert.strictEqual(otherDay, null, "autre jour autorisé");

  assert.strictEqual(normalizePresenceDay("23-07-2026"), "2026-07-23");
  assert.strictEqual(normalizePresenceDay("2026-07-23"), "2026-07-23");

  // Import dynamique du mapper PG si disponible
  const { PostgresRepository } = require("../db/postgresRepository");
  const repo = Object.create(PostgresRepository.prototype);
  assert.strictEqual(repo.toAttendanceStatus("Justifié", false), "excused");
  assert.strictEqual(repo.toAttendanceStatus("justifie", false), "excused");
  assert.strictEqual(repo.fromAttendanceStatus("excused"), "Justifié");

  console.log("presenceContract.test.js : OK");
}

run();
