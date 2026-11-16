"use strict";

/**
 * MONO-T0-GUARDS — gardes d'écriture des notes (POST /api/notes → upsertGrade),
 * sur fixtures PostgreSQL canoniques (aucun endpoint BackOffice retiré).
 *
 * Remplace l'intention des anciens scénarios P3, P4 et S3 de
 * pedagogyStaffSyncRepository.test.js et studentsSyncRepository.test.js, qui
 * ne s'exécutaient plus depuis LOT 8 (arrêt sur saveBackOfficeState → 410).
 *
 *   teacherCanAccessStudentClass  — classe de l'élève affectée à l'enseignant ;
 *   teacherCanAccessEvaluation    — établissement, enseignant, année, classe + matière ;
 *   resolveStudentForGrade        — lookup canonique scopé ; branche historique BO.
 *
 * Chaque refus vérifie aussi la porte qui refuse (trace d'autorisation
 * observée via `_activeNotesAuthzTrace`, sans variable d'environnement).
 * Aucune logique métier n'est modifiée.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { guardPgPool } = require("./pgPoolGuard");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_NOTES_TEACHER_GUARDS_IT_DATABASE ?? "somafrik_notes_teacher_guards_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const skip = DATABASE_URL ? false : "DATABASE_URL absent";

const SCHOOL_A = "CD-2026-0001";
const SCHOOL_B = "BI-2026-0001";

let pool = null;
let repo = null;
const f = {};

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

const teacher = (sub, schoolCode = SCHOOL_A) => ({ role: "Enseignant", sub, schoolCode });

/** Exécute une garde en observant sa trace ; renvoie { result, steps }. */
async function traced(fn) {
  const trace = { steps: [] };
  repo._activeNotesAuthzTrace = trace;
  try {
    const result = await fn();
    return { result, steps: trace.steps };
  } finally {
    repo._activeNotesAuthzTrace = null;
  }
}

const lastStep = (steps) => steps.at(-1) ?? {};

async function insert(sql, params) {
  return (await pool.query(sql, params)).rows[0].id;
}

async function seed() {
  const country = await insert(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  f.schoolA = await insert(
    `INSERT INTO schools (country_id, school_code, login_code, name, status)
     VALUES ($1, $2, 'CD-LGA-26-001', 'Lycée A', 'active') RETURNING id`,
    [country, SCHOOL_A],
  );
  f.schoolB = await insert(
    `INSERT INTO schools (country_id, school_code, login_code, name, status)
     VALUES ($1, $2, 'BI-LGB-26-001', 'Lycée B', 'active') RETURNING id`,
    [country, SCHOOL_B],
  );
  f.yearA = await insert(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [f.schoolA],
  );
  f.yearAPrev = await insert(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2024-2025', 'closed') RETURNING id`,
    [f.schoolA],
  );
  f.yearB = await insert(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [f.schoolB],
  );
  f.termA = await insert(
    `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
    [f.yearA],
  );
  f.termAPrev = await insert(
    `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1 (2024)', 'closed') RETURNING id`,
    [f.yearAPrev],
  );
  f.termB = await insert(
    `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
    [f.yearB],
  );
  const klass = (schoolId, yearId, code, name) =>
    insert(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [schoolId, yearId, code, name],
    );
  f.classA1 = await klass(f.schoolA, f.yearA, "CLS-G-6A", "6ème A");
  f.classA2 = await klass(f.schoolA, f.yearA, "CLS-G-6B", "6ème B");
  f.classB1 = await klass(f.schoolB, f.yearB, "CLS-G-B6A", "6ème A Buj");
  const subject = (schoolId, code, name) =>
    insert(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, $2, $3, 1, 'active') RETURNING id`,
      [schoolId, code, name],
    );
  f.mathA = await subject(f.schoolA, "SUB-G-MATH", "Mathématiques");
  f.physA = await subject(f.schoolA, "SUB-G-PHY", "Physique");
  f.mathB = await subject(f.schoolB, "SUB-G-MATH-B", "Mathématiques");

  const user = (schoolId, code, role) =>
    insert(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, $2, 'Prénom', $3, $4, $5, 'active') RETURNING id`,
      [schoolId, code, code, `${code.toLowerCase()}@guards.test`, role],
    );
  const teacherRow = (schoolId, userId, code) =>
    insert(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [schoolId, userId, code],
    );
  const assign = (schoolId, teacherId, classId, subjectId, yearId, status) =>
    pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [schoolId, teacherId, classId, subjectId, yearId, status],
    );

  // Enseignant affecté : 6ème A / Mathématiques (actif), 6ème A / Physique (inactif).
  f.userT = await user(f.schoolA, "USR-G-ENS-T", "TEACHER");
  f.teacherT = await teacherRow(f.schoolA, f.userT, "ENS-G-T");
  await assign(f.schoolA, f.teacherT, f.classA1, f.mathA, f.yearA, "active");
  await assign(f.schoolA, f.teacherT, f.classA1, f.physA, f.yearA, "inactive");
  // Enseignant dont la seule affectation (6ème B) est inactive.
  f.userV = await user(f.schoolA, "USR-G-ENS-V", "TEACHER");
  f.teacherV = await teacherRow(f.schoolA, f.userV, "ENS-G-V");
  await assign(f.schoolA, f.teacherV, f.classA2, f.mathA, f.yearA, "inactive");
  // Compte au rôle enseignant sans fiche teachers.
  f.userNoTeacher = await user(f.schoolA, "USR-G-ENS-NONE", "TEACHER");
  // Enseignant de l'école B, affecté en B.
  f.userB = await user(f.schoolB, "USR-G-ENS-B", "TEACHER");
  f.teacherB = await teacherRow(f.schoolB, f.userB, "ENS-G-B");
  await assign(f.schoolB, f.teacherB, f.classB1, f.mathB, f.yearB, "active");

  const student = async (schoolId, code, classId, yearId) => {
    const id = await insert(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, $2, 'Élève', $3, 'active') RETURNING id`,
      [schoolId, code, code],
    );
    if (classId) {
      await pool.query(
        `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [schoolId, id, classId, yearId],
      );
    }
    return id;
  };
  f.studentA1 = await student(f.schoolA, "CD-G-STU-A1", f.classA1, f.yearA);
  f.studentA2 = await student(f.schoolA, "CD-G-STU-A2", f.classA2, f.yearA);
  f.studentNoClass = await student(f.schoolA, "CD-G-STU-NOCLASS", null, null);
  f.studentB1 = await student(f.schoolB, "BI-G-STU-B1", f.classB1, f.yearB);

  const evaluation = (schoolId, classId, subjectId, termId, key) =>
    insert(
      `INSERT INTO evaluations (school_id, class_id, subject_id, term_id, title, evaluation_type,
         evaluation_date, max_score, coefficient, status, active, legacy_json_id)
       VALUES ($1, $2, $3, $4, $5, 'devoir', '2026-01-15', 20, 1, 'published', true, $6)
       RETURNING id`,
      [schoolId, classId, subjectId, termId, key, key],
    );
  f.evalMathA1 = await evaluation(f.schoolA, f.classA1, f.mathA, f.termA, "EV-G-MATH-A1");
  f.evalPhysA1 = await evaluation(f.schoolA, f.classA1, f.physA, f.termA, "EV-G-PHY-A1");
  f.evalMathA2 = await evaluation(f.schoolA, f.classA2, f.mathA, f.termA, "EV-G-MATH-A2");
  f.evalMathA1Prev = await evaluation(f.schoolA, f.classA1, f.mathA, f.termAPrev, "EV-G-MATH-A1-PREV");
  f.evalMathB1 = await evaluation(f.schoolB, f.classB1, f.mathB, f.termB, "EV-G-MATH-B1");
}

/** Lignes réelles, chargées comme upsertGrade les charge. */
const studentRow = (code, schoolCode = SCHOOL_A) =>
  repo.queryStudentWithClass(code, schoolCode).then(({ row }) => row);
const evaluationRow = (id) => repo.resolveEvaluationRow(id, null);

before(async () => {
  if (!DATABASE_URL) return;
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DB]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DB}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DB);
  pool = guardPgPool(new Pool({ connectionString: url }));
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await pool.query(PEDAGOGY_SCHEMA_SQL);
  await seed();
  repo = createPostgresRepository(url);
  guardPgPool(repo.pool);
  repo.ready = true;
});

after(async () => {
  if (repo) await repo.pool.end();
  if (pool) await pool.end();
});

// ---------------------------------------------------------------------------
// teacherCanAccessStudentClass
// ---------------------------------------------------------------------------

test("classe élève : enseignant affecté (affectation active) autorisé", { skip }, async () => {
  const student = await studentRow("CD-G-STU-A1");
  assert.equal(String(student.class_id), String(f.classA1));
  const { result, steps } = await traced(() => repo.teacherCanAccessStudentClass(teacher(f.userT), student));
  assert.equal(result, true);
  assert.equal(repo._lastTeacherClassAccessVia, "pg_teacher_assignment");
  assert.equal(lastStep(steps).result, "allow");
});

test("classe élève : classe non affectée refusée", { skip }, async () => {
  const { result, steps } = await traced(async () =>
    repo.teacherCanAccessStudentClass(teacher(f.userT), await studentRow("CD-G-STU-A2")),
  );
  assert.equal(result, false);
  assert.deepEqual(
    { gate: lastStep(steps).gate, result: lastStep(steps).result },
    { gate: "pg_teacher_assignment", result: "deny" },
  );
});

test("classe élève : affectation inactive seule ⇒ refus", { skip }, async () => {
  const { result, steps } = await traced(async () =>
    repo.teacherCanAccessStudentClass(teacher(f.userV), await studentRow("CD-G-STU-A2")),
  );
  assert.equal(result, false);
  assert.equal(lastStep(steps).result, "deny");
});

test("classe élève : identifiant BO (user_code) ou compte sans fiche enseignant ⇒ refus", { skip }, async () => {
  const student = await studentRow("CD-G-STU-A1");
  for (const sub of ["USR-G-ENS-T", f.userNoTeacher, "", crypto.randomUUID()]) {
    const { result, steps } = await traced(() => repo.teacherCanAccessStudentClass(teacher(sub), student));
    assert.equal(result, false, `sub=${sub || "(vide)"}`);
    assert.deepEqual(lastStep(steps), { ...lastStep(steps), gate: "pg_teacher_lookup", teacherId: null });
  }
});

test("classe élève : élève d'un autre établissement ⇒ refus (fiche enseignant scopée à l'école de l'élève)", { skip }, async () => {
  const studentB = await studentRow("BI-G-STU-B1", SCHOOL_B);
  const { result, steps } = await traced(() => repo.teacherCanAccessStudentClass(teacher(f.userT), studentB));
  assert.equal(result, false);
  assert.equal(lastStep(steps).teacherId, null);
});

test("classe élève : élève sans inscription active (class_id absent) ⇒ refus", { skip }, async () => {
  const student = await studentRow("CD-G-STU-NOCLASS");
  assert.equal(student.class_id, null);
  const { result, steps } = await traced(() => repo.teacherCanAccessStudentClass(teacher(f.userT), student));
  assert.equal(result, false);
  assert.equal(lastStep(steps).gate, "pg_teacher_lookup", "refus avant toute lecture d'affectation");
});

test("classe élève : principal non enseignant ⇒ garde non applicable (autres contrôles RBAC en amont)", { skip }, async () => {
  const student = await studentRow("CD-G-STU-A2");
  const result = await repo.teacherCanAccessStudentClass(
    { role: "Admin School", sub: f.userT, schoolCode: SCHOOL_A },
    student,
  );
  assert.equal(result, true);
  assert.equal(repo._lastTeacherClassAccessVia, "non_teacher");
});

// ---------------------------------------------------------------------------
// teacherCanAccessEvaluation
// ---------------------------------------------------------------------------

test("évaluation : classe + matière + année affectées ⇒ autorisé", { skip }, async () => {
  const { result, steps } = await traced(async () =>
    repo.teacherCanAccessEvaluation(teacher(f.userT), await evaluationRow(f.evalMathA1), await studentRow("CD-G-STU-A1")),
  );
  assert.equal(result, true);
  assert.equal(repo._lastTeacherEvaluationAccessVia, "pg_teacher_assignment");
  assert.equal(String(lastStep(steps).academicYearId), String(f.yearA), "année déduite du trimestre");
});

test("évaluation : matière non affectée (affectation inactive) ⇒ refus", { skip }, async () => {
  const { result, steps } = await traced(async () =>
    repo.teacherCanAccessEvaluation(teacher(f.userT), await evaluationRow(f.evalPhysA1), await studentRow("CD-G-STU-A1")),
  );
  assert.equal(result, false);
  assert.deepEqual(
    { gate: lastStep(steps).gate, result: lastStep(steps).result, reason: lastStep(steps).reason },
    { gate: "pg_teacher_assignment_subject", result: "deny", reason: undefined },
  );
});

test("évaluation : classe non affectée ⇒ refus", { skip }, async () => {
  const { result } = await traced(async () =>
    repo.teacherCanAccessEvaluation(teacher(f.userT), await evaluationRow(f.evalMathA2), await studentRow("CD-G-STU-A2")),
  );
  assert.equal(result, false);
});

test("évaluation : affectation d'une autre année scolaire ⇒ refus", { skip }, async () => {
  const { result, steps } = await traced(async () =>
    repo.teacherCanAccessEvaluation(
      teacher(f.userT),
      await evaluationRow(f.evalMathA1Prev),
      await studentRow("CD-G-STU-A1"),
    ),
  );
  assert.equal(result, false);
  assert.equal(String(lastStep(steps).academicYearId), String(f.yearAPrev));
  assert.equal(lastStep(steps).result, "deny");
});

test("évaluation : interétablissement (principal école A, évaluation école B) ⇒ refus à la porte établissement", { skip }, async () => {
  const { result, steps } = await traced(async () =>
    repo.teacherCanAccessEvaluation(teacher(f.userT), await evaluationRow(f.evalMathB1), await studentRow("CD-G-STU-A1")),
  );
  assert.equal(result, false);
  assert.deepEqual(
    {
      gate: lastStep(steps).gate,
      result: lastStep(steps).result,
      principalSchool: lastStep(steps).principalSchool,
      evaluationSchoolCode: lastStep(steps).evaluationSchoolCode,
    },
    { gate: "evaluation_school", result: "deny", principalSchool: SCHOOL_A, evaluationSchoolCode: SCHOOL_B },
  );
});

test("évaluation : interétablissement même en revendiquant l'école B ⇒ aucune fiche enseignant en B, refus", { skip }, async () => {
  for (const schoolCode of [SCHOOL_B, "*", ""]) {
    const { result, steps } = await traced(async () =>
      repo.teacherCanAccessEvaluation(
        teacher(f.userT, schoolCode),
        await evaluationRow(f.evalMathB1),
        await studentRow("BI-G-STU-B1", SCHOOL_B),
      ),
    );
    assert.equal(result, false, `schoolCode=${schoolCode || "(vide)"}`);
    assert.deepEqual(
      { gate: lastStep(steps).gate, result: lastStep(steps).result },
      { gate: "pg_teacher_lookup_for_evaluation", result: "miss" },
    );
  }
});

test("évaluation : enseignant inexistant (compte sans fiche, user_code BO, UUID inconnu) ⇒ refus", { skip }, async () => {
  const evaluation = await evaluationRow(f.evalMathA1);
  const student = await studentRow("CD-G-STU-A1");
  for (const sub of [f.userNoTeacher, "USR-G-ENS-T", crypto.randomUUID()]) {
    const { result, steps } = await traced(() => repo.teacherCanAccessEvaluation(teacher(sub), evaluation, student));
    assert.equal(result, false, `sub=${sub}`);
    assert.deepEqual(
      { gate: lastStep(steps).gate, result: lastStep(steps).result },
      { gate: "pg_teacher_lookup_for_evaluation", result: "miss" },
    );
  }
});

test("évaluation : année scolaire introuvable ⇒ refus (garde défensive)", { skip }, async () => {
  // Inatteignable depuis upsertGrade : evaluations.term_id, terms.academic_year_id et
  // classes.academic_year_id sont NOT NULL. La garde reste fail-closed si l'entrée
  // ne permet pas de déduire l'année.
  const evaluation = { ...(await evaluationRow(f.evalMathA1)), term_id: null, class_id: crypto.randomUUID() };
  const { result, steps } = await traced(() =>
    repo.teacherCanAccessEvaluation(teacher(f.userT), evaluation, null),
  );
  assert.equal(result, false);
  assert.deepEqual(
    { gate: lastStep(steps).gate, result: lastStep(steps).result, reason: lastStep(steps).reason },
    { gate: "pg_teacher_assignment_subject", result: "deny", reason: "missing_academic_year" },
  );
});

test("évaluation : classe ou matière absente ⇒ refus", { skip }, async () => {
  const base = await evaluationRow(f.evalMathA1);
  for (const evaluation of [{ ...base, class_id: null }, { ...base, subject_id: null }, null]) {
    const { result, steps } = await traced(() => repo.teacherCanAccessEvaluation(teacher(f.userT), evaluation, null));
    assert.equal(result, false);
    assert.equal(lastStep(steps).reason, "missing_class_or_subject_id");
  }
});

test("évaluation : principal non enseignant ⇒ garde non applicable", { skip }, async () => {
  const result = await repo.teacherCanAccessEvaluation(
    { role: "Admin School", sub: f.userT, schoolCode: SCHOOL_A },
    await evaluationRow(f.evalMathB1),
    null,
  );
  assert.equal(result, true);
  assert.equal(repo._lastTeacherEvaluationAccessVia, "non_teacher");
});

// ---------------------------------------------------------------------------
// resolveStudentForGrade
// ---------------------------------------------------------------------------

test("élève : résolution canonique par matricule ou UUID, avec sa classe active", { skip }, async () => {
  for (const key of ["CD-G-STU-A1", String(f.studentA1)]) {
    const student = await repo.resolveStudentForGrade(key, SCHOOL_A);
    assert.equal(String(student.id), String(f.studentA1), key);
    assert.equal(String(student.school_id), String(f.schoolA));
    assert.equal(String(student.class_id), String(f.classA1));
  }
});

test("élève : jamais résolu hors de l'établissement demandé", { skip }, async () => {
  assert.equal(await repo.resolveStudentForGrade("CD-G-STU-A1", SCHOOL_B), null);
  assert.equal(await repo.resolveStudentForGrade(String(f.studentB1), SCHOOL_A), null);
  assert.equal(await repo.resolveStudentForGrade("cd-g-stu-a1", SCHOOL_A), null, "pas de recherche approximative");
});

test("élève : clé vide ou inconnue ⇒ null", { skip }, async () => {
  assert.equal(await repo.resolveStudentForGrade("", SCHOOL_A), null);
  assert.equal(await repo.resolveStudentForGrade("   ", SCHOOL_A), null);
  assert.equal(await repo.resolveStudentForGrade("Élève CD-G-STU-A1", SCHOOL_A), null, "pas de recherche nominale");
});

test("élève : branche historique BackOffice inatteignable (LOT 8) ⇒ aucune matérialisation", { skip }, async () => {
  // getBackOfficeState() renvoie toujours null depuis LOT 8 : findBackOfficeStudentRecord
  // ne trouve jamais d'élève BO, donc materializeBackOfficeStudent n'est jamais appelé.
  assert.equal(await repo.getBackOfficeState(), null);
  const original = repo.materializeBackOfficeStudent;
  let calls = 0;
  repo.materializeBackOfficeStudent = async (...args) => {
    calls += 1;
    return original.apply(repo, args);
  };
  const studentsBefore = (await pool.query("SELECT count(*)::int AS n FROM students")).rows[0].n;
  try {
    for (const key of ["STU-BO-LEGACY-1", "CD-G-STU-A1"]) {
      await repo.resolveStudentForGrade(key, SCHOOL_A);
      await repo.resolveStudentForGrade(key, SCHOOL_B);
    }
  } finally {
    repo.materializeBackOfficeStudent = original;
  }
  assert.equal(calls, 0, "aucune matérialisation BO");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM students")).rows[0].n, studentsBefore);
});
