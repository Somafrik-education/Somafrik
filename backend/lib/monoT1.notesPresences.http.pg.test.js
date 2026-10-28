"use strict";

/**
 * MONO-T1 / D — notes et présences (serveur réel, base jetable, démo seed).
 *
 * Types d'évaluation, évaluations, saisie des notes (POST /api/notes →
 * upsertSchoolGrade, gardes couvertes au niveau dépôt par MONO-T0-GUARDS),
 * appel de présence : autorisé, anonyme, permission insuffisante,
 * interétablissement, affectation classe/matière, entrée invalide, absence
 * d'écriture en cas de refus.
 *
 * Données de démonstration : l'enseignant patrick.ilunga@somafrik.cd
 * (CD-2026-0001-ENS-0003) est affecté en Sciences à 6ème A (CLS-2026-000035),
 * 5ème A et 6ème B ; 1ère B (CLS-2026-000036) ne lui est pas affectée.
 * Précondition : abonnement actif réel de la fixture (vérifié, aucune écriture).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;
let evaluationId = null;

const ASSIGNED_CLASS = { className: "6ème A", code: "CLS-2026-000035" };
const UNASSIGNED_CLASS = { className: "1ère B", code: "CLS-2026-000036" };
const STUDENT_IN_CLASS = "CD-IN-EL-26-001";
const STUDENT_IN_CLASS_2 = "CD-IN-EL-26-002";
const STUDENT_OTHER_CLASS = "CD-IN-EL-26-005";

// Les noms de classe de la démo sont ambigus (trois « 6ème A ») et la résolution
// par nom n'est pas déterministe (anomalie MONO-T1-A4) : les tests désignent la
// classe par classId, prioritaire sur className.
const classIds = {};
const evaluationBody = (overrides = {}) => ({
  classId: classIds[ASSIGNED_CLASS.code],
  className: ASSIGNED_CLASS.className,
  subject: "Sciences",
  period: "Trimestre 1",
  title: "MONO-T1 devoir",
  maxScore: 20,
  evaluationType: "devoir",
  ...overrides,
});

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_notes_it", port: 19964 });
  await server.assertActiveSubscriptionPrecondition();
  const rows = await server.pool.query("SELECT class_code, id FROM classes WHERE class_code = ANY($1)", [
    [ASSIGNED_CLASS.code, UNASSIGNED_CLASS.code, "CLS-2026-000041"],
  ]);
  for (const row of rows.rows) classIds[row.class_code] = row.id;
});

after(async () => {
  if (server) await server.stop();
});

const count = (table) => server.snapshot(`SELECT count(*)::int AS n FROM ${table}`);

test("types d'évaluation : création admin bornée à son établissement ; enseignant/anonyme refusés ; invalide/doublon", { skip }, async () => {
  const before = await count("evaluation_types");
  assertStatus(
    await server.request("POST", "/api/evaluation-types", { token: await server.login("cdTeacher"), body: { code: "interro", name: "Interrogation" } }),
    403,
    "enseignant",
  );
  assertStatus(await server.request("POST", "/api/evaluation-types", { body: { code: "interro", name: "Interrogation" } }), 401, "anonyme");
  assertStatus(
    await server.request("POST", "/api/evaluation-types", { token: await server.login("cdAdmin"), body: { code: "x" } }),
    400,
    "nom manquant",
  );
  assert.equal(await count("evaluation_types"), before, "aucune écriture après refus");

  const created = await server.request("POST", "/api/evaluation-types", {
    token: await server.login("cdAdmin"),
    body: { code: "devoir", name: "Devoir", displayOrder: 10 },
  });
  assertStatus(created, 201, "création admin CD");
  assert.equal(created.data.schoolCode, "CD-2026-0001");
  const duplicate = await server.request("POST", "/api/evaluation-types", {
    token: await server.login("cdAdmin"),
    body: { code: "devoir", name: "Devoir" },
  });
  assertStatus(duplicate, 409, "doublon");

  // L'établissement vient du principal, jamais du corps : BI crée chez BI.
  const bi = await server.request("POST", "/api/evaluation-types", {
    token: await server.login("biAdmin"),
    body: { code: "devoir", name: "Devoir", schoolCode: "CD-2026-0001" },
  });
  assertStatus(bi, 201, "création admin BI");
  assert.equal(bi.data.schoolCode, "BI-2026-0002");
  const cdTypes = await server.request("GET", "/api/evaluation-types", { token: await server.login("cdAdmin") });
  assert.deepEqual(cdTypes.data.types.map((type) => type.schoolCode), ["CD-2026-0001"], "CD ne voit pas le type de BI");
});

test("évaluations : création par l'enseignant affecté ; refus classe/matière non affectées, admin, parent, BI, invalide — sans écriture", { skip }, async () => {
  const before = await count("evaluations");
  const refusals = [
    [
      "classe non affectée",
      "cdTeacher",
      evaluationBody({ classId: classIds[UNASSIGNED_CLASS.code], className: UNASSIGNED_CLASS.className }),
      403,
      "TEACHER_ASSIGNMENT_REQUIRED",
    ],
    ["matière non affectée", "cdTeacher", evaluationBody({ subject: "Mathématiques" }), 403, "TEACHER_ASSIGNMENT_REQUIRED"],
    ["barème négatif", "cdTeacher", evaluationBody({ maxScore: -5 }), 400, "GRADE_INVALID"],
    ["admin établissement (pas de permission de création)", "cdAdmin", evaluationBody(), 403, "PERMISSION_DENIED"],
    ["parent", "cdParent", evaluationBody(), 403, "PERMISSION_DENIED"],
    ["admin BI", "biAdmin", evaluationBody(), 403, "PERMISSION_DENIED"],
    ["anonyme", null, evaluationBody(), 401, undefined],
  ];
  for (const [label, account, body, status, code] of refusals) {
    const response = await server.request("POST", "/api/evaluations", { token: account && (await server.login(account)), body });
    assertStatus(response, status, label);
    if (code) assert.equal(response.data.code, code, label);
  }
  assert.equal(await count("evaluations"), before, "aucune évaluation créée après refus");

  const created = await server.request("POST", "/api/evaluations", { token: await server.login("cdTeacher"), body: evaluationBody() });
  assertStatus(created, 201, "création enseignant affecté");
  evaluationId = created.data.id;
  const row = await server.one(
    `SELECT c.class_code, s.school_code FROM evaluations e JOIN classes c ON c.id = e.class_id
     JOIN schools s ON s.id = e.school_id WHERE e.id = $1`,
    [evaluationId],
  );
  assert.deepEqual(row, { class_code: ASSIGNED_CLASS.code, school_code: "CD-2026-0001" });
});

test("évaluations : classId prioritaire ; classCode du corps ignoré", { skip }, async () => {
  const created = await server.request("POST", "/api/evaluations", {
    token: await server.login("cdTeacher"),
    body: evaluationBody({
      classId: classIds["CLS-2026-000041"],
      className: "6ème B",
      classCode: UNASSIGNED_CLASS.code,
      title: "MONO-T1 résolution",
    }),
  });
  assertStatus(created, 201, "création 6ème B par classId");
  const row = await server.one(`SELECT c.class_code FROM evaluations e JOIN classes c ON c.id = e.class_id WHERE e.id = $1`, [
    created.data.id,
  ]);
  assert.deepEqual(row, { class_code: "CLS-2026-000041" }, "rattachée au classId, le classCode fourni (1ère B) est ignoré");
});

test("évaluations : listes bornées (enseignant voit les siennes, BI aucune)", { skip }, async () => {
  const teacher = await server.request("GET", "/api/evaluations", { token: await server.login("cdTeacher") });
  assertStatus(teacher, 200, "liste enseignant");
  assert.ok(teacher.data.some((evaluation) => evaluation.id === evaluationId));
  const bi = await server.request("GET", "/api/evaluations", { token: await server.login("biAdmin") });
  assertStatus(bi, 200, "liste BI");
  assert.deepEqual(bi.data, []);
});

test("notes : saisie et correction par l'enseignant affecté (une seule ligne, valeur mise à jour)", { skip }, async () => {
  assert.ok(evaluationId, "évaluation créée");
  const teacher = await server.login("cdTeacher");
  const first = await server.request("POST", "/api/notes", { token: teacher, body: { studentId: STUDENT_IN_CLASS, evaluationId, value: 14 } });
  assertStatus(first, 201, "saisie");
  const second = await server.request("POST", "/api/notes", { token: teacher, body: { studentId: STUDENT_IN_CLASS, evaluationId, value: 15 } });
  assertStatus(second, 201, "correction");
  assert.equal(second.data.id, first.data.id, "même note (upsert)");
  const rows = await server.pool.query(
    `SELECT g.score::float AS score FROM grades g JOIN students s ON s.id = g.student_id
     WHERE g.evaluation_id = $1 AND s.student_code = $2`,
    [evaluationId, STUDENT_IN_CLASS],
  );
  assert.deepEqual(rows.rows, [{ score: 15 }]);
});

test("notes : refus élève hors classe, hors barème, sans élève, BI, parent, admin sans clé enseignant, anonyme — sans écriture", { skip }, async () => {
  const before = await server.snapshot("SELECT id, score FROM grades ORDER BY id");
  const refusals = [
    ["élève hors classe de l'évaluation", "cdTeacher", { studentId: STUDENT_OTHER_CLASS, evaluationId, value: 12 }, 409, "STUDENT_NOT_ENROLLED"],
    ["note hors barème", "cdTeacher", { studentId: STUDENT_IN_CLASS_2, evaluationId, value: 25 }, 400, undefined],
    ["élève manquant", "cdTeacher", { evaluationId, value: 10 }, 400, undefined],
    ["admin BI", "biAdmin", { studentId: STUDENT_IN_CLASS_2, evaluationId, value: 10 }, 404, undefined],
    ["parent", "cdParent", { studentId: STUDENT_IN_CLASS_2, evaluationId, value: 10 }, 403, "PARENT_NOTES_READ_ONLY"],
    ["admin sans clé enseignant", "cdAdmin", { studentId: STUDENT_IN_CLASS_2, evaluationId, value: 10 }, 409, "GRADE_TEACHER_UNRESOLVED"],
    ["anonyme", null, { studentId: STUDENT_IN_CLASS_2, evaluationId, value: 10 }, 401, undefined],
  ];
  for (const [label, account, body, status, code] of refusals) {
    const response = await server.request("POST", "/api/notes", { token: account && (await server.login(account)), body });
    assertStatus(response, status, label);
    if (code) assert.equal(response.data.code, code, label);
  }
  assert.equal(await server.snapshot("SELECT id, score FROM grades ORDER BY id"), before, "aucune note écrite après refus");
});

test("notes : lecture bornée (enseignant voit la note, BI aucune)", { skip }, async () => {
  const teacher = await server.request("GET", "/api/notes", { token: await server.login("cdTeacher") });
  assertStatus(teacher, 200, "liste enseignant");
  assert.ok(teacher.data.some((note) => note.studentId === STUDENT_IN_CLASS));
  const bi = await server.request("GET", "/api/notes", { token: await server.login("biAdmin") });
  assertStatus(bi, 200, "liste BI");
  assert.deepEqual(bi.data, []);
});

test("présences : appel par l'enseignant affecté ; refus classe non affectée, BI, parent, anonyme — sans écriture", { skip }, async () => {
  const date = "2026-10-20";
  const item = (studentId, classCode, status = "Présent") => ({ studentId, date, status, classCode });
  const before = await server.snapshot("SELECT id, status FROM attendance ORDER BY id");
  const refusals = [
    ["classe non affectée", "cdTeacher", { classCode: UNASSIGNED_CLASS.code, items: [item(STUDENT_OTHER_CLASS, UNASSIGNED_CLASS.code)] }, 403],
    ["admin BI", "biAdmin", { classCode: ASSIGNED_CLASS.code, items: [item(STUDENT_IN_CLASS, ASSIGNED_CLASS.code, "Absent")] }, 404],
    ["parent", "cdParent", { classCode: ASSIGNED_CLASS.code, items: [item(STUDENT_IN_CLASS, ASSIGNED_CLASS.code, "Absent")] }, 403],
    ["anonyme", null, { classCode: ASSIGNED_CLASS.code, items: [item(STUDENT_IN_CLASS, ASSIGNED_CLASS.code, "Absent")] }, 401],
  ];
  for (const [label, account, body, status] of refusals) {
    assertStatus(await server.request("POST", "/api/presences", { token: account && (await server.login(account)), body }), status, label);
  }
  assert.equal(await server.snapshot("SELECT id, status FROM attendance ORDER BY id"), before, "aucune présence écrite après refus");

  const saved = await server.request("POST", "/api/presences", {
    token: await server.login("cdTeacher"),
    body: { classCode: ASSIGNED_CLASS.code, items: [item(STUDENT_IN_CLASS, ASSIGNED_CLASS.code, "Retard")] },
  });
  assertStatus(saved, 201, "appel enseignant affecté");
  const row = await server.one(
    `SELECT a.status FROM attendance a JOIN students s ON s.id = a.student_id WHERE s.student_code = $1 AND a.attendance_date = $2`,
    [STUDENT_IN_CLASS, date],
  );
  assert.deepEqual(row, { status: "late" });
  const empty = await server.request("POST", "/api/presences", {
    token: await server.login("cdTeacher"),
    body: { classCode: ASSIGNED_CLASS.code, items: [] },
  });
  assertStatus(empty, 201, "appel vide accepté (comportement actuel)");
  assert.deepEqual(empty.data, []);
  const bi = await server.request("GET", "/api/presences", { token: await server.login("biAdmin") });
  assertStatus(bi, 200, "lecture BI");
  assert.deepEqual(bi.data, []);
});
