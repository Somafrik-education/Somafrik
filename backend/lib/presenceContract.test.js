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
  assert.strictEqual(repo.toAttendanceStatus("Présent", false), "present");
  assert.strictEqual(repo.toAttendanceStatus("Absent", true), "absent");
  assert.strictEqual(repo.toAttendanceStatus("Retard", false), "late");
  assert.strictEqual(repo.fromAttendanceStatus("present"), "Présent");
  assert.strictEqual(repo.fromAttendanceStatus("absent"), "Absent");
  assert.strictEqual(repo.fromAttendanceStatus("late"), "Retard");
  const mappedPresent = repo.mapAttendance({
    id: "a1",
    school_id: "s1",
    school_code: "CD-IN-26-001",
    student_code: "QA-ATT-A1",
    class_id: "c1",
    class_code: "QA-APPEL-6A",
    class_name: "QA-APPEL-6A",
    attendance_date: "2026-08-23",
    status: "present",
  });
  assert.strictEqual(mappedPresent.present, true);
  const mappedJustified = repo.mapAttendance({
    id: "a2",
    school_id: "s1",
    school_code: "CD-IN-26-001",
    student_code: "QA-ATT-D1",
    class_id: "c1",
    class_code: "QA-APPEL-6A",
    class_name: "QA-APPEL-6A",
    attendance_date: "2026-08-23",
    status: "excused",
  });
  assert.strictEqual(mappedJustified.status, "Justifié");
  assert.strictEqual(mappedJustified.present, false, "Justifié = absence justifiée");

  console.log("presenceContract.test.js : OK");
}

run();
