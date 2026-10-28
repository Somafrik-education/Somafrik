"use strict";

/**
 * MONO-FIX-A3 — validation stricte des statuts de présence (serveur réel, base jetable).
 *
 * POST /api/presences : un statut hors catalogue (Présent, Absent, Retard,
 * Justifié et variantes historiques) est refusé en 400
 * ATTENDANCE_STATUS_INVALID, sans aucune écriture ni écrasement, y compris
 * pour un lot dont un seul élément est invalide (tout ou rien). Les statuts
 * valides, la mise à jour d'un appel existant, les permissions enseignant et
 * l'isolation entre établissements sont inchangés.
 *
 * Données : démo CD-2026-0001 ; l'enseignant patrick.ilunga@somafrik.cd est
 * affecté en Sciences à CLS-2026-000035 (6ème A), pas à CLS-2026-000036.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

const ASSIGNED_CLASS = "CLS-2026-000035";
const UNASSIGNED_CLASS = "CLS-2026-000036";
let server = null;
let students = [];
let otherClassStudent = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_a3_validation_it", port: 19978 });
  await server.assertActiveSubscriptionPrecondition();
  const enrolled = async (classCode) =>
    (
      await server.pool.query(
        `SELECT s.student_code FROM students s
         JOIN enrollments e ON e.student_id = s.id AND lower(e.status) IN ('active', 'enrolled')
         JOIN classes c ON c.id = e.class_id
         WHERE c.class_code = $1 AND s.status = 'active' ORDER BY s.student_code`,
        [classCode],
      )
    ).rows.map((row) => row.student_code);
  students = await enrolled(ASSIGNED_CLASS);
  assert.ok(students.length >= 2, `précondition : élèves inscrits en ${ASSIGNED_CLASS}`);
  otherClassStudent = (await enrolled(UNASSIGNED_CLASS))[0];
  assert.ok(otherClassStudent, `précondition : élève inscrit en ${UNASSIGNED_CLASS}`);
});

after(async () => {
  if (server) await server.stop();
});

const attendanceSnapshot = () => server.snapshot("SELECT id, student_id, attendance_date, status, reason FROM attendance ORDER BY id");

function body(items, classCode = ASSIGNED_CLASS) {
  return { classCode, items: items.map((item) => ({ classCode, ...item })) };
}

async function post(accountKey, payload) {
  return server.request("POST", "/api/presences", { token: await server.login(accountKey), body: payload });
}

async function storedStatus(studentCode, date) {
  const row = await server.one(
    `SELECT a.status FROM attendance a JOIN students s ON s.id = a.student_id
     WHERE s.student_code = $1 AND a.attendance_date = $2`,
    [studentCode, date],
  );
  return row?.status ?? null;
}

test("statuts valides et variantes historiques : 201 et valeur interne attendue ; mise à jour d'un appel existant", { skip }, async () => {
  const date = "2026-10-05";
  const cases = [
    ["Présent", "present"], ["Absent", "absent"], ["Retard", "late"], ["Justifié", "excused"],
    ["present", "present"], ["late", "late"], ["excused", "excused"], ["JUSTIFIEE", "excused"], ["absence", "absent"],
  ];
  const student = students[0];
  for (const [label, internal] of cases) {
    const response = await post("cdTeacher", body([{ studentId: student, date, status: label }]));
    assertStatus(response, 201, `statut « ${label} »`);
    assert.equal(await storedStatus(student, date), internal, `« ${label} » enregistré « ${internal} »`);
  }
  // Booléen historique sans statut texte : conservé.
  assertStatus(await post("cdTeacher", body([{ studentId: student, date, present: true }])), 201, "present: true sans statut");
  assert.equal(await storedStatus(student, date), "present");
  const rows = await server.one(
    `SELECT count(*)::int AS n FROM attendance a JOIN students s ON s.id = a.student_id WHERE s.student_code = $1 AND a.attendance_date = $2`,
    [student, date],
  );
  assert.equal(rows.n, 1, "mise à jour : une seule ligne par élève et par jour");
});

test("statut inconnu, vide, nul ou mal typé : 400 ATTENDANCE_STATUS_INVALID, appel existant intact, aucune écriture", { skip }, async () => {
  const date = "2026-10-06";
  const student = students[0];
  assertStatus(await post("cdTeacher", body([{ studentId: student, date, status: "Présent" }])), 201, "précondition");
  const before = await attendanceSnapshot();
  const invalid = [
    ["Inventé", { status: "Inventé" }],
    ["Inventé + present:false", { status: "Inventé", present: false }],
    ["chaîne vide", { status: "" }],
    ["null", { status: null }],
    ["absent du corps", {}],
    ["nombre", { status: 1 }],
    ["booléen", { status: false }],
    ["objet", { status: { label: "Absent" } }],
    ["tableau", { status: ["Absent"] }],
  ];
  for (const [label, fields] of invalid) {
    const response = await post("cdTeacher", body([{ studentId: student, date, ...fields }]));
    assertStatus(response, 400, label);
    assert.equal(response.data?.code, "ATTENDANCE_STATUS_INVALID", `${label} : code`);
  }
  assert.equal(await attendanceSnapshot(), before, "aucune présence écrite ni modifiée");
  assert.equal(await storedStatus(student, date), "present", "l'appel « Présent » n'est pas écrasé");
});

test("lot de 20 éléments dont un seul invalide : 400, aucune des 20 écritures (tout ou rien)", { skip }, async () => {
  const dates = Array.from({ length: 10 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
  const items = [];
  for (const date of dates) for (const student of students.slice(0, 2)) items.push({ studentId: student, date, status: "Absent" });
  assert.equal(items.length, 20);
  for (const position of [0, 12, 19]) {
    const before = await attendanceSnapshot();
    const batch = items.map((item, index) => (index === position ? { ...item, status: "Inventé" } : item));
    const response = await post("cdTeacher", body(batch));
    assertStatus(response, 400, `élément invalide en position ${position + 1}`);
    assert.equal(response.data?.code, "ATTENDANCE_STATUS_INVALID");
    assert.equal(response.data?.details?.index, position);
    assert.equal(await attendanceSnapshot(), before, `position ${position + 1} : aucune écriture partielle`);
  }
  // Contrôle : le même lot, entièrement valide, écrit bien ses 20 présences.
  const before = await server.one("SELECT count(*)::int AS n FROM attendance");
  assertStatus(await post("cdTeacher", body(items)), 201, "lot valide");
  const afterCount = await server.one("SELECT count(*)::int AS n FROM attendance");
  assert.equal(afterCount.n - before.n, 20, "20 présences écrites");
});

test("permissions et isolation inchangées (statuts valides) : classe non affectée, autre établissement, parent, anonyme", { skip }, async () => {
  const date = "2026-10-07";
  const before = await attendanceSnapshot();
  assertStatus(
    await post("cdTeacher", body([{ studentId: otherClassStudent, date, status: "Absent" }], UNASSIGNED_CLASS)),
    403,
    "enseignant sur classe non affectée",
  );
  assertStatus(await post("biAdmin", body([{ studentId: students[0], date, status: "Absent" }])), 404, "administrateur d'un autre établissement");
  assertStatus(await post("cdParent", body([{ studentId: students[0], date, status: "Absent" }])), 403, "parent");
  assertStatus(
    await server.request("POST", "/api/presences", { body: body([{ studentId: students[0], date, status: "Absent" }]) }),
    401,
    "anonyme",
  );
  assert.equal(await attendanceSnapshot(), before, "aucune écriture après refus");
});
