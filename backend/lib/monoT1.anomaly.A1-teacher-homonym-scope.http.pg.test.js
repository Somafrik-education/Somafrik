"use strict";

/**
 * ANOMALIE-MONO-T1-A1 — périmètre enseignant fondé sur un homonyme.
 *
 * CORRIGÉE par #1011 (dad5591d) : test de non-régression, exécuté normalement
 * par la baseline pg (retiré de manifest › expectedFailures). Il exprime le
 * comportement correct et échouerait si le défaut réapparaissait.
 *
 * Constat : à la connexion, les affectations portées par le jeton enseignant
 * sont rapprochées par NOM (authService.assignmentMatchesTeacher, repli sur
 * teacherName). La démo compte quatre « Patrick Ilunga » dans CD-2026-0001 :
 * le jeton de l'un embarque les classes des autres, et GET /api/students
 * (filtré sur ces revendications) expose des élèves de classes non affectées
 * tout en omettant une classe réellement affectée.
 * Source de vérité attendue : teacher_assignments actives de la fiche
 * enseignant liée au compte (teachers.user_id).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startCharacterizationServer, skipWithoutDatabase: skip, assertStatus } = require("./monoT1HttpHarness");

let server = null;

before(async () => {
  if (skip) return;
  server = await startCharacterizationServer({ database: "somafrik_mono_t1_anomaly_a1_it", port: 19971 });
});

after(async () => {
  if (server) await server.stop();
});

test("ANOMALIE-MONO-T1-A1 : l'enseignant ne voit que les élèves des classes de SES affectations actives", { skip }, async () => {
  const canonical = (
    await server.pool.query(
      `SELECT DISTINCT st.student_code
       FROM users u
       JOIN teachers t ON t.user_id = u.id
       JOIN teacher_assignments ta ON ta.teacher_id = t.id AND lower(ta.status) = 'active'
       JOIN enrollments e ON e.class_id = ta.class_id AND lower(e.status) IN ('active', 'enrolled')
       JOIN students st ON st.id = e.student_id AND st.status = 'active'
       WHERE u.email = 'patrick.ilunga@somafrik.cd'
       ORDER BY 1`,
    )
  ).rows.map((row) => row.student_code);
  assert.ok(canonical.length > 0, "précondition : l'enseignant a des élèves affectés");
  const response = await server.request("GET", "/api/students", { token: await server.login("cdTeacher") });
  assertStatus(response, 200, "liste enseignant");
  const visible = response.data.map((student) => student.studentCode).sort();
  const leaked = visible.filter((code) => !canonical.includes(code));
  const missing = canonical.filter((code) => !visible.includes(code));
  assert.deepEqual(
    { leaked, missing },
    { leaked: [], missing: [] },
    `ANOMALIE-MONO-T1-A1 : périmètre enseignant ≠ affectations canoniques (élèves hors affectation exposés : ${leaked.length}, élèves affectés absents : ${missing.length})`,
  );
});
