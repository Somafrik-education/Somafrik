"use strict";

/**
 * PostgreSQL : identité live Assignments vs Classes + apply uniquement si UNLINKED univoque.
 *   node --test backend/lib/teacherCanonicalIdentityAudit.pg.test.js
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createTeacherAssignmentsRepository } = require("../db/teacherAssignmentsRepository");
const { createClassesRepository } = require("../db/classesRepository");
const {
  classifyInventory,
  loadInventory,
  applyCanonicalLink,
} = require("./teacherCanonicalIdentityAudit");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_TEACHER_CANONICAL_IDENTITY_IT_DATABASE ?? "somafrik_teacher_canonical_identity_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const USER_ID = "c81b0ec1-b8dd-4f09-8357-6775586920ff";
const SCHOOL_ID = "3b11f338-38a9-43ba-9321-ebfc526b21af";
const TEACHER_ID = "cd866ff1-92f5-4bf6-9086-dce64f903717";
const YEAR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLASS_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];
const SUBJECT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSIGN_IDS = [
  "dddddddd-dddd-4ddd-8ddd-dddddddddd01",
  "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
  "dddddddd-dddd-4ddd-8ddd-dddddddddd03",
  "dddddddd-dddd-4ddd-8ddd-dddddddddd04",
];

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) {
      await pool.query(`CREATE DATABASE ${databaseName}`);
    }
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createDb(pool) {
  return {
    one: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    all: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return result.rows;
    },
  };
}

async function setup(pool, { userSchoolId = SCHOOL_ID, teacherUserId = USER_ID } = {}) {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS countries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      iso_code VARCHAR(8) NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS schools (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      country_id UUID NOT NULL REFERENCES countries(id),
      school_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID REFERENCES schools(id),
      user_code VARCHAR(64) NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS teachers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      user_id UUID REFERENCES users(id),
      teacher_code VARCHAR(64) NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      class_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      subject_code VARCHAR(64) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      teacher_id UUID NOT NULL REFERENCES teachers(id),
      class_id UUID NOT NULL REFERENCES classes(id),
      subject_id UUID NOT NULL REFERENCES subjects(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id),
      assignment_role TEXT NOT NULL DEFAULT 'primary',
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      school_id UUID REFERENCES schools(id),
      role_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  await pool.query(
    "TRUNCATE teacher_assignments, teachers, user_roles, users, subjects, classes, academic_years, schools, countries CASCADE",
  );

  await pool.query(`INSERT INTO countries (id, name, iso_code) VALUES (gen_random_uuid(), 'Test', 'TT')`);
  const country = await pool.query("SELECT id FROM countries LIMIT 1");
  await pool.query(
    `INSERT INTO schools (id, country_id, school_code, name) VALUES ($1, $2, 'CD-2026-0001', 'Lycée')`,
    [SCHOOL_ID, country.rows[0].id],
  );
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, $2, 'USR-2026-00007', 'KILOMBO', 'SEKE', 'TEACHER', 'active')`,
    [USER_ID, userSchoolId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, 'TEACHER', 'active')`,
    [USER_ID, SCHOOL_ID],
  );
  await pool.query(
    `INSERT INTO teachers (id, school_id, user_id, teacher_code, status)
     VALUES ($1, $2, $3, 'CD-2026-0001-ENS-0001', 'active')`,
    [TEACHER_ID, SCHOOL_ID, teacherUserId],
  );
  await pool.query(
    `INSERT INTO academic_years (id, school_id, name) VALUES ($1, $2, '2025-2026')`,
    [YEAR_ID, SCHOOL_ID],
  );
  await pool.query(
    `INSERT INTO classes (id, school_id, academic_year_id, class_code, name)
     VALUES ($1, $4, $5, '1A', '1ère A'), ($2, $4, $5, '2A', '2ème A'), ($3, $4, $5, '2C', '2ème C')`,
    [CLASS_IDS[0], CLASS_IDS[1], CLASS_IDS[2], SCHOOL_ID, YEAR_ID],
  );
  await pool.query(
    `INSERT INTO subjects (id, school_id, subject_code, name) VALUES ($1, $2, 'MATH', 'Mathématiques')`,
    [SUBJECT_ID, SCHOOL_ID],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (id, school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES
       ($1, $5, $6, $7, $8, $9, 'active'),
       ($2, $5, $6, $10, $8, $9, 'active'),
       ($3, $5, $6, $10, $8, $9, 'active'),
       ($4, $5, $6, $11, $8, $9, 'active')`,
    [
      ASSIGN_IDS[0],
      ASSIGN_IDS[1],
      ASSIGN_IDS[2],
      ASSIGN_IDS[3],
      SCHOOL_ID,
      TEACHER_ID,
      CLASS_IDS[0],
      SUBJECT_ID,
      YEAR_ID,
      CLASS_IDS[1],
      CLASS_IDS[2],
    ],
  );
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP teacherCanonicalIdentityAudit.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const db = createDb(pool);
  const assignmentsRepo = createTeacherAssignmentsRepository(db);
  const classesRepo = createClassesRepository(db);

  try {
    await setup(pool, { userSchoolId: null, teacherUserId: USER_ID });
    const classes = await classesRepo.listLiveTeacherClassAssignmentsForSync(USER_ID, SCHOOL_ID);
    assert.equal(classes.length, 3, "Classes : user_id suffit même si users.school_id est NULL");
    const identity = await assignmentsRepo.getLiveTeacherIdentityForSchool(USER_ID, SCHOOL_ID);
    assert.equal(identity?.teacherId, TEACHER_ID, "Assignments : même contrat que Classes");
    const ids = await assignmentsRepo.listLiveTeacherAssignmentIdsForSync(SCHOOL_ID, identity.teacherId);
    assert.equal(ids.length, 4);

    await setup(pool, { userSchoolId: SCHOOL_ID, teacherUserId: null });
    const missing = await assignmentsRepo.getLiveTeacherIdentityForSchool(USER_ID, SCHOOL_ID);
    assert.equal(missing, null, "fail-closed si teachers.user_id NULL");
    const emptyClasses = await classesRepo.listLiveTeacherClassAssignmentsForSync(USER_ID, SCHOOL_ID);
    assert.equal(emptyClasses.length, 0);

    const inventory = await loadInventory(db, { name: "KILOMBO SEKE" });
    const classified = classifyInventory(inventory, { expectedAssignments: 4 });
    assert.equal(classified.verdict, "REPAIRABLE_UNLINKED");
    const applied = await applyCanonicalLink(db, classified);
    assert.equal(applied.teacher_user_id, USER_ID);
    const after = await assignmentsRepo.getLiveTeacherIdentityForSchool(USER_ID, SCHOOL_ID);
    assert.equal(after?.teacherId, TEACHER_ID);
    const afterIds = await assignmentsRepo.listLiveTeacherAssignmentIdsForSync(SCHOOL_ID, after.teacherId);
    assert.equal(afterIds.length, 4);

    const canonical = classifyInventory(await loadInventory(db, { name: "KILOMBO SEKE" }), {
      expectedAssignments: 4,
    });
    assert.equal(canonical.verdict, "CANONICAL");
    await assert.rejects(
      () => applyCanonicalLink(db, canonical),
      (error) => error.code === "TEACHER_CANONICAL_APPLY_REFUSED",
    );

    console.log("teacherCanonicalIdentityAudit.pg.test.js: OK unlink/fail-closed/school_id NULL/apply");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
