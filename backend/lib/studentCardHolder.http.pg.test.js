"use strict";

/**
 * CARTE-CYCLE-01 — titulaire de carte (élève / étudiant) : routes HTTP de production, PostgreSQL
 * local jetable (fixture d'intégration), identités synthétiques.
 * Garde d'émission avant tout jeton, réglage explicite canonique, établissements mixtes, isolation.
 */
const { after, before, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createIntegrationFixture } = require("./studentCardsNfcIntegration.fixture");

let f;
let A;
let B;
let settingsTokenA;

before(async () => {
  f = await createIntegrationFixture();
  [A, B] = f.schools;
  settingsTokenA = await f.mint({
    sub: A.user,
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: A.code,
    mustChangePassword: false,
    permissions: ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE", "Élèves:READ", "Élèves:UPDATE", "Voir élèves", "Gérer élèves"],
  });
});
after(async () => {
  if (!f) return;
  // Même démontage que studentCardsNfcProvision.http.pg.test.js : la base jetable est supprimée de force.
  for (const pool of [f.pool, f.repo?.pool]) pool?.on?.("error", () => {});
  await f.close();
});
beforeEach(async () => {
  // Point de départ : aucun réglage explicite (la fixture configure « élève » par défaut).
  await f.pool.query("UPDATE school_settings SET student_card_holder_kind = NULL, student_card_holder_levels = '{}'::jsonb");
  await f.pool.query("UPDATE schools SET school_type = NULL");
});

const setType = (school, type) => f.pool.query("UPDATE schools SET school_type = $2 WHERE id = $1", [school.id, type]);
const cardsOf = async (studentId) => (await f.pool.query("SELECT id, status FROM student_access_cards WHERE student_id = $1", [studentId])).rows;
const issuedAudits = async () => Number((await f.pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'student_card_issued'")).rows[0].n);
const issue = (studentId, token = A.token) => f.request("/student-cards", { method: "POST", body: JSON.stringify({ studentId, medium: "qr" }) }, token);
const holderOf = async (studentId, token = A.token) => (await f.request(`/students/${studentId}/cards`, {}, token)).data.holder;
const patchSettings = (body, token = settingsTokenA) => f.request("/school-settings", { method: "PATCH", body: JSON.stringify(body) }, token);

async function activeLevel(school, code) {
  const country = (await f.pool.query("SELECT country_id FROM schools WHERE id = $1", [school.id])).rows[0].country_id;
  const level = (await f.pool.query(
    "INSERT INTO education_levels(country_id, level_code, name) VALUES($1, $2, $3) RETURNING id::text AS id",
    [country, `${code}-${randomUUID().slice(0, 8)}`, `Niveau ${code}`],
  )).rows[0].id;
  await f.pool.query("INSERT INTO school_levels(school_id, level_id, status) VALUES($1, $2, 'active')", [school.id, level]);
  return level;
}

test("type indéterminé (Institut, Centre de formation, libre, absent, casse différente) : émission refusée avant tout jeton", async () => {
  for (const type of ["Institut", "Centre de formation", "Établissement", "lycée", null]) {
    await setType(A, type);
    const { students: [student] } = await f.cohort(1);
    const auditsBefore = await issuedAudits();
    const response = await issue(student);
    assert.equal(response.status, 409, String(type));
    assert.equal(response.data.code, "STUDENT_CARD_HOLDER_UNDETERMINED");
    assert.equal(JSON.stringify(response.data).includes("cardToken"), false, "aucun jeton renvoyé");
    assert.deepEqual(await cardsOf(student), [], "aucune carte créée ni consommée");
    assert.equal(await issuedAudits(), auditsBefore, "aucun audit d'émission");
    assert.deepEqual(await holderOf(student), { kind: null, source: null });
  }
});

test("type exact déterminant : École primaire / Collège / Lycée → élève, Université → étudiant", async () => {
  for (const [type, kind] of [["École primaire", "eleve"], ["Collège", "eleve"], ["Lycée", "eleve"], ["Université", "etudiant"]]) {
    await setType(A, type);
    const { students: [student] } = await f.cohort(1);
    assert.deepEqual(await holderOf(student), { kind, source: "school_type" }, type);
    const response = await issue(student);
    assert.equal(response.status, 201, type);
    assert.ok(response.data.cardToken);
  }
});

test("réglage explicite canonique (school_settings) : lu, persisté, audité et prioritaire sur le type", async () => {
  await setType(A, "Institut");
  const { students: [student] } = await f.cohort(1);
  const saved = await patchSettings({ studentCardHolderKind: "etudiant" });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.studentCardHolderKind, "etudiant");
  assert.equal(saved.data.studentCardHolderFromSchoolType, null, "Institut : aucune déduction");
  const read = await f.request("/school-settings", {}, settingsTokenA);
  assert.equal(read.data.studentCardHolderKind, "etudiant");
  assert.deepEqual(read.data.studentCardHolderLevels, {});
  const row = (await f.pool.query("SELECT student_card_holder_kind FROM school_settings WHERE school_id = $1", [A.id])).rows[0];
  assert.equal(row.student_card_holder_kind, "etudiant");
  const audit = (await f.pool.query(
    "SELECT new_value FROM audit_logs WHERE action = 'update_school_settings' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1",
    [A.id],
  )).rows[0];
  assert.equal(audit.new_value.studentCardHolderKind, "etudiant");
  assert.deepEqual(await holderOf(student), { kind: "etudiant", source: "school_setting" });
  assert.equal((await issue(student)).status, 201);
  await setType(A, "Lycée");
  assert.deepEqual(await holderOf(student), { kind: "etudiant", source: "school_setting" }, "le réglage explicite prime sur le type");
  assert.equal((await patchSettings({ studentCardHolderKind: null })).status, 200);
  assert.deepEqual(await holderOf(student), { kind: "eleve", source: "school_type" });
});

test("établissement mixte : surcharge par niveau ; une autre section non configurée reste bloquée", async () => {
  await setType(A, "Institut");
  const levelSup = await activeLevel(A, "SUP");
  const levelSec = await activeLevel(A, "SEC");
  const sup = await f.cohort(1);
  const sec = await f.cohort(1);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [sup.classId, levelSup]);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [sec.classId, levelSec]);
  const saved = await patchSettings({ studentCardHolderLevels: { [levelSup]: "etudiant" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.studentCardHolderLevels, { [levelSup]: "etudiant" });
  assert.deepEqual(await holderOf(sup.students[0]), { kind: "etudiant", source: "level_setting" });
  assert.deepEqual(await holderOf(sec.students[0]), { kind: null, source: null }, "pas de libellé étudiant pour la section secondaire");
  assert.equal((await issue(sec.students[0])).status, 409);
  assert.equal((await issue(sup.students[0])).status, 201);
  await patchSettings({ studentCardHolderKind: "eleve", studentCardHolderLevels: { [levelSup]: "etudiant" } });
  assert.deepEqual(await holderOf(sec.students[0]), { kind: "eleve", source: "school_setting" });
  assert.deepEqual(await holderOf(sup.students[0]), { kind: "etudiant", source: "level_setting" }, "la surcharge de niveau prime");
});

test("surcharge refusée pour un niveau non activé ou activé seulement dans un autre établissement", async () => {
  const levelB = await activeLevel(B, "B-ONLY");
  const response = await patchSettings({ studentCardHolderLevels: { [levelB]: "etudiant" } });
  assert.equal(response.status, 400);
  assert.equal(response.data.code, "INVALID_STUDENT_CARD_HOLDER_LEVEL");
  const unknown = await patchSettings({ studentCardHolderLevels: { [randomUUID()]: "eleve" } });
  assert.equal(unknown.status, 400);
  const row = (await f.pool.query("SELECT student_card_holder_levels FROM school_settings WHERE school_id = $1", [A.id])).rows[0];
  assert.deepEqual(row.student_card_holder_levels, {}, "rien n'est enregistré");
  for (const body of [{ studentCardHolderKind: "Eleve" }, { studentCardHolderLevels: [] }]) {
    assert.equal((await patchSettings(body)).status, 400, JSON.stringify(body));
  }
});

test("isolation : le réglage de l'établissement A n'affecte pas l'établissement B", async () => {
  await setType(A, "Institut");
  await setType(B, "Institut");
  assert.equal((await patchSettings({ studentCardHolderKind: "eleve" })).status, 200);
  const { students: [studentB] } = await f.cohort(1, B);
  assert.deepEqual(await holderOf(studentB, B.token), { kind: null, source: null });
  assert.equal((await issue(studentB, B.token)).status, 409);
  const rowB = (await f.pool.query("SELECT student_card_holder_kind FROM school_settings WHERE school_id = $1", [B.id])).rows[0];
  assert.equal(rowB.student_card_holder_kind, null);
});

test("RBAC : sans droit de modification des paramètres, aucun changement de titulaire", async () => {
  // Permissions relues en direct pour l'utilisateur (live RBAC) : l'enseignant n'a pas Paramètres Établissement:UPDATE.
  const teacher = await patchSettings({ studentCardHolderKind: "etudiant" }, f.extraTokens.teacher);
  assert.equal(teacher.status, 403);
  const row = (await f.pool.query("SELECT student_card_holder_kind FROM school_settings WHERE school_id = $1", [A.id])).rows[0];
  assert.equal(row.student_card_holder_kind, null);
});

test("remplacement refusé si le titulaire devient indéterminé : l'ancienne carte reste active, aucun jeton", async () => {
  await setType(A, "Lycée");
  const { students: [student] } = await f.cohort(1);
  const issued = await issue(student);
  assert.equal(issued.status, 201);
  await setType(A, "Institut");
  const replaced = await f.request(`/student-cards/${issued.data.id}/replace`, { method: "POST", body: "{}" });
  assert.equal(replaced.status, 409);
  assert.equal(replaced.data.code, "STUDENT_CARD_HOLDER_UNDETERMINED");
  assert.equal(JSON.stringify(replaced.data).includes("cardToken"), false);
  assert.deepEqual(await cardsOf(student), [{ id: issued.data.id, status: "active" }], "carte existante intacte");
});

test("cartes existantes intactes : changer le titulaire ne modifie aucune carte émise", async () => {
  await setType(A, "Lycée");
  const { students: [student] } = await f.cohort(1);
  const issued = await issue(student);
  const before = (await f.pool.query("SELECT * FROM student_access_cards WHERE id = $1", [issued.data.id])).rows[0];
  await patchSettings({ studentCardHolderKind: "etudiant" });
  await setType(A, "Institut");
  await patchSettings({ studentCardHolderKind: null });
  const afterRow = (await f.pool.query("SELECT * FROM student_access_cards WHERE id = $1", [issued.data.id])).rows[0];
  assert.deepEqual(afterRow, before);
});

test("mixte fail-closed : inscription absente, classe sans niveau, niveau désactivé → aucun libellé, aucune carte", async () => {
  // Global « élève » ET type Lycée présents : ils ne doivent jamais combler un niveau incertain.
  await setType(A, "Lycée");
  // Une classe par niveau et par année (uq_classes_structural_offering) : un niveau surchargé par cas.
  const levelSup = await activeLevel(A, "SUP");
  const levelSupGone = await activeLevel(A, "SUP-A");
  const levelSupMoved = await activeLevel(A, "SUP-B");
  const levelSec = await activeLevel(A, "SEC");
  const overrides = { [levelSup]: "etudiant", [levelSupGone]: "etudiant", [levelSupMoved]: "etudiant" };
  assert.equal((await patchSettings({ studentCardHolderKind: "eleve", studentCardHolderLevels: overrides })).status, 200);
  const blocked = async (student, label) => {
    const auditsBefore = await issuedAudits();
    assert.deepEqual(await holderOf(student), { kind: null, source: null }, label);
    const response = await issue(student);
    assert.equal(response.status, 409, label);
    assert.equal(response.data.code, "STUDENT_CARD_HOLDER_UNDETERMINED", label);
    assert.deepEqual(await cardsOf(student), [], `${label} : aucune carte`);
    assert.equal(await issuedAudits(), auditsBefore, `${label} : aucun audit d'émission`);
  };

  const noEnrollment = await f.cohort(1);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [noEnrollment.classId, levelSupGone]);
  await f.pool.query("DELETE FROM enrollments WHERE student_id = $1", [noEnrollment.students[0]]);
  await blocked(noEnrollment.students[0], "inscription courante absente");

  const withdrawn = await f.cohort(1);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [withdrawn.classId, levelSupMoved]);
  await f.pool.query("UPDATE enrollments SET status = 'TRANSFERRED' WHERE student_id = $1", [withdrawn.students[0]]);
  await blocked(withdrawn.students[0], "inscription non courante");

  const noLevel = await f.cohort(1);
  await blocked(noLevel.students[0], "classe sans niveau");

  const sup = await f.cohort(1);
  const sec = await f.cohort(1);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [sup.classId, levelSup]);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [sec.classId, levelSec]);
  assert.deepEqual(await holderOf(sup.students[0]), { kind: "etudiant", source: "level_setting" });
  assert.deepEqual(await holderOf(sec.students[0]), { kind: "eleve", source: "school_setting" }, "niveau actif sans surcharge : réglage global");

  // Désactivation après configuration : la surcharge obsolète n'a plus d'effet, le global ne la remplace pas.
  await f.pool.query("UPDATE school_levels SET status = 'archived' WHERE school_id = $1 AND level_id = $2", [A.id, levelSup]);
  await blocked(sup.students[0], "niveau surchargé archivé");
  await f.pool.query("DELETE FROM school_levels WHERE school_id = $1 AND level_id = $2", [A.id, levelSec]);
  await blocked(sec.students[0], "niveau non surchargé retiré du référentiel");
  // Réactivation : le niveau redevient certain, la surcharge enregistrée s'applique de nouveau.
  await f.pool.query("UPDATE school_levels SET status = 'active' WHERE school_id = $1 AND level_id = $2", [A.id, levelSup]);
  assert.deepEqual(await holderOf(sup.students[0]), { kind: "etudiant", source: "level_setting" });
});

test("mixte : surcharge d'un autre niveau et conflit global / niveau ne produisent jamais un libellé erroné", async () => {
  await setType(A, "Université");
  const levelPrepa = await activeLevel(A, "PREPA");
  const levelLic = await activeLevel(A, "LIC");
  const levelB = await activeLevel(B, "B-LIC");
  const prepa = await f.cohort(1);
  const lic = await f.cohort(1);
  const foreignLevel = await f.cohort(1);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [prepa.classId, levelPrepa]);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [lic.classId, levelLic]);
  // Donnée incohérente : classe de A rattachée à un niveau activé seulement dans B.
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [foreignLevel.classId, levelB]);

  // Conflit : global « étudiant », surcharge « élève » pour la prépa → la surcharge prime pour la prépa seulement.
  assert.equal((await patchSettings({ studentCardHolderKind: "etudiant", studentCardHolderLevels: { [levelPrepa]: "eleve" } })).status, 200);
  assert.deepEqual(await holderOf(prepa.students[0]), { kind: "eleve", source: "level_setting" });
  assert.deepEqual(await holderOf(lic.students[0]), { kind: "etudiant", source: "school_setting" });
  assert.deepEqual(await holderOf(foreignLevel.students[0]), { kind: null, source: null }, "niveau non actif dans A");

  // Surcharge écrite directement en base pour un niveau d'un autre établissement : sans effet dans A.
  await f.pool.query("UPDATE school_settings SET student_card_holder_kind = NULL, student_card_holder_levels = $2::jsonb WHERE school_id = $1",
    [A.id, JSON.stringify({ [levelB]: "etudiant" })]);
  assert.deepEqual(await holderOf(foreignLevel.students[0]), { kind: null, source: null }, "surcharge étrangère ignorée");
  assert.deepEqual(await holderOf(lic.students[0]), { kind: "etudiant", source: "school_type" }, "niveau actif sans surcharge : type exact");
  assert.equal((await issue(foreignLevel.students[0])).status, 409);
});

test("cohérence transactionnelle : une désactivation concurrente bloque la sauvegarde jusqu'à son issue", async () => {
  const levelX = await activeLevel(A, "TX");
  const levelY = await activeLevel(A, "TY");
  const settle = (promise) => promise.then((value) => ({ done: true, value }));
  const pending = (ms) => new Promise((resolve) => setTimeout(() => resolve({ done: false }), ms));

  // 1. Désactivation en cours puis validée : le PATCH attend, puis voit le niveau retiré → 400, rien d'écrit.
  const deactivator = await f.pool.connect();
  try {
    await deactivator.query("BEGIN");
    await deactivator.query("DELETE FROM school_levels WHERE school_id = $1 AND level_id = $2", [A.id, levelX]);
    const save = patchSettings({ studentCardHolderLevels: { [levelX]: "etudiant" } });
    assert.equal((await Promise.race([settle(save), pending(400)])).done, false, "le PATCH attend la transaction concurrente");
    await deactivator.query("COMMIT");
    const response = await save;
    assert.equal(response.status, 400);
    assert.equal(response.data.code, "INVALID_STUDENT_CARD_HOLDER_LEVEL");
  } finally {
    deactivator.release();
  }
  let row = (await f.pool.query("SELECT student_card_holder_levels FROM school_settings WHERE school_id = $1", [A.id])).rows[0];
  assert.deepEqual(row.student_card_holder_levels, {}, "surcharge vers un niveau retiré jamais enregistrée");

  // 2. Désactivation annulée : le PATCH attend puis réussit sur un niveau resté actif.
  const rollback = await f.pool.connect();
  try {
    await rollback.query("BEGIN");
    await rollback.query("UPDATE school_levels SET status = 'archived' WHERE school_id = $1 AND level_id = $2", [A.id, levelY]);
    const save = patchSettings({ studentCardHolderLevels: { [levelY]: "eleve" } });
    assert.equal((await Promise.race([settle(save), pending(400)])).done, false);
    await rollback.query("ROLLBACK");
    assert.equal((await save).status, 200);
  } finally {
    rollback.release();
  }
  row = (await f.pool.query("SELECT student_card_holder_levels FROM school_settings WHERE school_id = $1", [A.id])).rows[0];
  assert.deepEqual(row.student_card_holder_levels, { [levelY]: "eleve" });

  // 3. Désactivation APRÈS la sauvegarde : elle n'attend pas indéfiniment et la surcharge devient sans effet.
  const student = await f.cohort(1);
  await f.pool.query("UPDATE classes SET level_id = $2 WHERE id = $1", [student.classId, levelY]);
  assert.deepEqual(await holderOf(student.students[0]), { kind: "eleve", source: "level_setting" });
  await f.pool.query("DELETE FROM school_levels WHERE school_id = $1 AND level_id = $2", [A.id, levelY]);
  assert.deepEqual(await holderOf(student.students[0]), { kind: null, source: null });
  assert.equal((await issue(student.students[0])).status, 409);
});
