"use strict";

/**
 * BULLETIN-MODEL-01 — hiérarchie matière principale → sous-matières (PostgreSQL).
 *
 * Base jetable dédiée `somafrik_subject_hierarchy_it`, schéma réel appliqué par
 * PostgresRepository.init() (sans seed démo). Vérifie : migration additive et
 * idempotente, données existantes intactes, isolation des établissements
 * (matières homonymes), profondeur limitée à un niveau, doublons refusés,
 * retour arrière documenté et rejouable.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createPostgresRepository } = require("./repositoryFactory");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_subject_hierarchy_it";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function resetDatabase() {
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  return url;
}

const state = { repo: null, pool: null, a: null, b: null };

function hierarchy() {
  return require("./subjectHierarchySchema");
}

function store() {
  return require("./subjectHierarchyPgStore").createSubjectHierarchyPgStore(state.pool);
}

async function insertSchool(pool, { countryId, code, login, short, name }) {
  await pool.query("ALTER TABLE schools DISABLE TRIGGER USER");
  try {
    const row = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [countryId, code, login, short, name],
    );
    return row.rows[0].id;
  } finally {
    await pool.query("ALTER TABLE schools ENABLE TRIGGER USER");
  }
}

async function insertSubject(pool, schoolId, code, name) {
  const row = await pool.query(
    "INSERT INTO subjects (school_id, subject_code, name, status) VALUES ($1, $2, $3, 'active') RETURNING id",
    [schoolId, code, name],
  );
  return row.rows[0].id;
}

async function pgError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return null;
}

before(async () => {
  if (skip) return;
  const url = await resetDatabase();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  state.repo = createPostgresRepository(url);
  await state.repo.init();
  state.pool = state.repo.pool;
  const pool = state.pool;
  await pool.query(`
    ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
    ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
  `);
  const country = (
    await pool.query("INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id")
  ).rows[0].id;
  state.a = await insertSchool(pool, { countryId: country, code: "BI-2026-0101", login: "BI-AAA-26-001", short: "AAA", name: "École A" });
  state.b = await insertSchool(pool, { countryId: country, code: "BI-2026-0102", login: "BI-BBB-26-001", short: "BBB", name: "École B" });
  for (const [school, code, name] of [
    [state.a, "FRANCAIS", "Français"],
    [state.a, "FR_LECTURE", "Lecture"],
    [state.a, "FR_DICTEE", "Dictée"],
    [state.a, "MATHEMATIQUES", "Mathématiques"],
    [state.b, "FRANCAIS", "Français"],
    [state.b, "FR_LECTURE", "Lecture"],
    [state.b, "ANGLAIS", "Anglais"],
  ]) {
    await insertSubject(pool, school, code, name);
  }
});

after(async () => {
  if (state.pool && !state.pool.ended) await state.pool.end().catch(() => {});
});

test("migration additive : colonnes nullables, données existantes intactes, application idempotente", { skip }, async () => {
  const columns = await state.pool.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_name = 'subjects' AND column_name IN ('parent_subject_id', 'display_order') ORDER BY column_name`,
  );
  assert.deepEqual(columns.rows, [
    { column_name: "display_order", is_nullable: "YES" },
    { column_name: "parent_subject_id", is_nullable: "YES" },
  ]);
  const before = (await state.pool.query("SELECT id, school_id, subject_code, name, coefficient, status FROM subjects ORDER BY id")).rows;
  await hierarchy().ensureSubjectHierarchySchema(state.repo);
  await hierarchy().ensureSubjectHierarchySchema(state.repo);
  const afterRows = (await state.pool.query("SELECT id, school_id, subject_code, name, coefficient, status FROM subjects ORDER BY id")).rows;
  assert.deepEqual(afterRows, before);
  const parents = await state.pool.query("SELECT count(*)::int AS n FROM subjects WHERE parent_subject_id IS NOT NULL");
  assert.equal(parents.rows[0].n, 0, "aucune matière existante rattachée automatiquement");
});

test("rattachement d'une sous-matière dans son établissement ; catalogue limité à l'établissement", { skip }, async () => {
  await store().setSubjectParent({ schoolId: state.a, subjectCode: "FR_LECTURE", parentSubjectCode: "FRANCAIS" });
  await store().setSubjectParent({ schoolId: state.a, subjectCode: "FR_DICTEE", parentSubjectCode: "FRANCAIS", displayOrder: 2 });
  const catalogA = await store().listSchoolSubjectCatalog(state.a);
  assert.deepEqual(
    catalogA.map((row) => [row.subject_code, row.parent_subject_code, row.school_id === state.a]),
    [
      ["FRANCAIS", null, true],
      ["FR_DICTEE", "FRANCAIS", true],
      ["FR_LECTURE", "FRANCAIS", true],
      ["MATHEMATIQUES", null, true],
    ],
  );
  const catalogB = await store().listSchoolSubjectCatalog(state.b);
  assert.deepEqual(
    catalogB.map((row) => [row.subject_code, row.parent_subject_code]),
    [["ANGLAIS", null], ["FRANCAIS", null], ["FR_LECTURE", null]],
    "matières homonymes de B non affectées",
  );
});

test("isolation : aucun parent d'un autre établissement, ni par le service ni par SQL direct", { skip }, async () => {
  const viaStore = await pgError(store().setSubjectParent({ schoolId: state.a, subjectCode: "MATHEMATIQUES", parentSubjectCode: "ANGLAIS" }));
  assert.equal(viaStore?.code, "SUBJECT_PARENT_NOT_FOUND");
  const viaSql = await pgError(
    state.pool.query(
      `UPDATE subjects SET parent_subject_id = (SELECT id FROM subjects WHERE school_id = $2 AND subject_code = 'FRANCAIS')
       WHERE school_id = $1 AND subject_code = 'MATHEMATIQUES'`,
      [state.a, state.b],
    ),
  );
  assert.equal(viaSql?.code, "23503", "clé étrangère (school_id, parent_subject_id)");
  const unknownChild = await pgError(store().setSubjectParent({ schoolId: state.a, subjectCode: "ANGLAIS", parentSubjectCode: "FRANCAIS" }));
  assert.equal(unknownChild?.code, "SUBJECT_NOT_FOUND", "matière de B introuvable depuis A");
});

test("hiérarchie limitée à un niveau ; pas d'auto-référence ; pas de doublon de sous-matière", { skip }, async () => {
  const nested = await pgError(store().setSubjectParent({ schoolId: state.a, subjectCode: "MATHEMATIQUES", parentSubjectCode: "FR_LECTURE" }));
  assert.equal(nested?.code, "SUBJECT_NESTING_TOO_DEEP");
  const parentBecomesChild = await pgError(store().setSubjectParent({ schoolId: state.a, subjectCode: "FRANCAIS", parentSubjectCode: "MATHEMATIQUES" }));
  assert.equal(parentBecomesChild?.code, "SUBJECT_NESTING_TOO_DEEP");
  const self = await pgError(store().setSubjectParent({ schoolId: state.a, subjectCode: "MATHEMATIQUES", parentSubjectCode: "MATHEMATIQUES" }));
  assert.equal(self?.code, "SUBJECT_PARENT_INVALID");
  const duplicateId = await insertSubject(state.pool, state.a, "FR_LECTURE_BIS", " lecture ");
  const duplicate = await pgError(store().setSubjectParent({ schoolId: state.a, subjectCode: "FR_LECTURE_BIS", parentSubjectCode: "FRANCAIS" }));
  assert.equal(duplicate?.code, "SUBJECT_DUPLICATE_CHILD");
  await state.pool.query("DELETE FROM subjects WHERE id = $1", [duplicateId]);
});

test("suppression d'une matière principale ayant des sous-matières : refusée", { skip }, async () => {
  const error = await pgError(state.pool.query("DELETE FROM subjects WHERE school_id = $1 AND subject_code = 'FRANCAIS'", [state.a]));
  assert.equal(error?.code, "23503");
});

test("notes historiques non réécrites par le rattachement", { skip }, async () => {
  const pool = state.pool;
  const year = (await pool.query("INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id", [state.a])).rows[0].id;
  const term = (await pool.query("INSERT INTO terms (academic_year_id, name) VALUES ($1, 'Trimestre 1') RETURNING id", [year])).rows[0].id;
  const cls = (await pool.query("INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1, $2, 'SH-1', '1ère A') RETURNING id", [state.a, year])).rows[0].id;
  const studentId = (await pool.query("INSERT INTO students (school_id, student_code, first_name, last_name) VALUES ($1, 'SH-S1', 'Ama', 'Test') RETURNING id", [state.a])).rows[0].id;
  const teacher = (await pool.query("INSERT INTO teachers (school_id, teacher_code) VALUES ($1, 'SH-T1') RETURNING id", [state.a])).rows[0].id;
  const math = (await pool.query("SELECT id FROM subjects WHERE school_id = $1 AND subject_code = 'MATHEMATIQUES'", [state.a])).rows[0].id;
  await pool.query(
    `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, grade_type, score, max_score)
     VALUES ($1, $2, $3, $4, $5, $6, 'devoir', 14, 20)`,
    [state.a, studentId, cls, math, teacher, term],
  );
  const before = (await pool.query("SELECT id, subject_id, score, max_score, coefficient, version, updated_at FROM grades")).rows;
  const calcul = await insertSubject(pool, state.a, "MATH_CALCUL", "Calcul");
  await store().setSubjectParent({ schoolId: state.a, subjectCode: "MATH_CALCUL", parentSubjectCode: "MATHEMATIQUES" });
  const afterRows = (await pool.query("SELECT id, subject_id, score, max_score, coefficient, version, updated_at FROM grades")).rows;
  assert.deepEqual(afterRows, before);
  await store().setSubjectParent({ schoolId: state.a, subjectCode: "MATH_CALCUL", parentSubjectCode: null });
  const detached = await pool.query("SELECT parent_subject_id FROM subjects WHERE id = $1", [calcul]);
  assert.equal(detached.rows[0].parent_subject_id, null, "détachement possible");
});

test("catalogue PostgreSQL + modèle : une sous-matière d'un autre établissement est refusée", { skip }, async () => {
  const { validateSpec } = require("../lib/reportCard/academicRuleProfile");
  const { assertProfileSubjectsInCatalog } = require("../lib/reportCard/subjectCatalog");
  const profileSpec = validateSpec({
    periods: ["T1"],
    score_components: [{ id: "TJ" }, { id: "EX" }],
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    ranking: { enabled: false, ties: "competition" },
    aggregation: { mode: "weighted_sum", coefficient_default: 1, percentage: "points_over_max_100" },
    subjects: [
      { id: "FRANCAIS", order: 1 },
      { id: "FR_LECTURE", parent_id: "FRANCAIS", order: 1, components: { TJ: { max: 20 }, EX: { max: 30 } } },
      { id: "FR_DICTEE", parent_id: "FRANCAIS", order: 2, components: { TJ: { max: 20 }, EX: { max: 30 } } },
    ],
  });
  const catalogA = await store().listSchoolSubjectCatalog(state.a);
  assert.doesNotThrow(() => assertProfileSubjectsInCatalog({ schoolId: state.a, profileSpec, catalog: catalogA }));
  const catalogB = await store().listSchoolSubjectCatalog(state.b);
  assert.throws(
    () => assertProfileSubjectsInCatalog({ schoolId: state.a, profileSpec, catalog: catalogB }),
    (error) => error.code === "CATALOG_TENANT_MISMATCH",
  );
});

test("retour arrière documenté : colonnes et contraintes retirées, données conservées, migration rejouable", { skip }, async () => {
  const { SUBJECT_HIERARCHY_ROLLBACK_SQL } = hierarchy();
  const before = (await state.pool.query("SELECT id, subject_code, name FROM subjects ORDER BY id")).rows;
  await state.pool.query(SUBJECT_HIERARCHY_ROLLBACK_SQL);
  const columns = await state.pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'subjects' AND column_name IN ('parent_subject_id', 'display_order')",
  );
  assert.equal(columns.rowCount, 0);
  assert.deepEqual((await state.pool.query("SELECT id, subject_code, name FROM subjects ORDER BY id")).rows, before);
  await hierarchy().ensureSubjectHierarchySchema(state.repo);
  const reapplied = await state.pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'subjects' AND column_name IN ('parent_subject_id', 'display_order')",
  );
  assert.equal(reapplied.rowCount, 2);
});
