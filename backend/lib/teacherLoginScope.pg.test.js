"use strict";

/**
 * PostgreSQL : teacher_assignments JOIN classes JOIN subjects → JWT scope.
 * L'embed mapTeacher {className, course} ne doit pas faire disparaître classId.
 */
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { mapAssignment, SELECT_ASSIGNMENT } = require("../db/teacherAssignmentsRepository");
const { resolveTeacherAssignments } = require("../services/authService");
const {
  enrichTeacherUserWithActiveAssignments,
  teacherPrincipalAssignmentFields,
} = require("./teacherSessionAssignments");
const { scopeSchoolClassesForPrincipal } = require("./classStudentsAuthz");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_TEACHER_LOGIN_SCOPE_IT_DATABASE ?? "somafrik_teacher_login_scope_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl });
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

async function setupFixture(pool) {
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
      status TEXT NOT NULL DEFAULT 'active'
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
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  for (const table of [
    "teacher_assignments",
    "teachers",
    "users",
    "subjects",
    "classes",
    "academic_years",
    "schools",
    "countries",
  ]) {
    await pool.query(`DELETE FROM ${table}`);
  }

  const country = await pool.query(`INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`);
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name)
     VALUES ($1, 'CD-2026-0001', 'Lycée Scope') RETURNING id, school_code`,
    [country.rows[0].id],
  );
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [school.rows[0].id],
  );
  const classes = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-2A', '2ème A', 'active'), ($1, $2, 'CLS-2B', '2ème B', 'active')
     RETURNING id, class_code, name`,
    [school.rows[0].id, year.rows[0].id],
  );
  const subjects = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 'active'),
            ($1, 'SUB-PHYS', 'Physique', 'active')
     RETURNING id, subject_code`,
    [school.rows[0].id],
  );
  const math = subjects.rows.find((row) => row.subject_code === "SUB-MATH");
  const phys = subjects.rows.find((row) => row.subject_code === "SUB-PHYS");
  const user = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, 'USR-SEKE', 'Seke', 'Kilombo', 'TEACHER', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'CD-2026-0001-ENS-0099', 'active') RETURNING id, teacher_code, user_id`,
    [school.rows[0].id, user.rows[0].id],
  );
  for (const schoolClass of classes.rows) {
    await pool.query(
      `INSERT INTO teacher_assignments
         (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [school.rows[0].id, teacher.rows[0].id, schoolClass.id, math.id, year.rows[0].id],
    );
  }
  const classA = classes.rows.find((row) => row.class_code === "CLS-2A");
  await pool.query(
    `INSERT INTO teacher_assignments
       (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [school.rows[0].id, teacher.rows[0].id, classA.id, phys.id, year.rows[0].id],
  );

  return {
    schoolCode: school.rows[0].school_code,
    teacher: teacher.rows[0],
    userId: user.rows[0].id,
    classes: classes.rows,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("SKIP teacherLoginScope.pg.test.js: DATABASE_URL absent");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    const fixture = await setupFixture(pool);
    const pgRows = await pool.query(`${SELECT_ASSIGNMENT} WHERE t.teacher_code = $1 AND ta.status = 'active'`, [
      fixture.teacher.teacher_code,
    ]);
    assert.equal(pgRows.rows.length, 3);

    const global = pgRows.rows.map(mapAssignment);
    assert.ok(global.every((row) => row.classId && row.classCode && row.status === "active"));

    const embed = pgRows.rows.map((row) => ({ className: row.class_name, course: row.subject_name }));
    const teacher = {
      id: fixture.teacher.teacher_code,
      publicId: fixture.teacher.teacher_code,
      userId: fixture.userId,
      identifier: "ENS-0099",
      schoolCode: fixture.schoolCode,
      assignments: embed,
    };
    const user = {
      id: fixture.userId,
      identifier: "ENS-0099",
      role: "Enseignant",
      schoolCode: fixture.schoolCode,
    };

    const resolved = resolveTeacherAssignments(teacher, user, global);
    const canonical = resolved.filter((row) => row.classId && row.status === "active");
    assert.equal(canonical.length, 3, "PG canonique doit survivre à l'embed mapTeacher");

    const state = { teachers: [teacher], assignments: global };
    const loginUser = enrichTeacherUserWithActiveAssignments(user, state);
    assert.equal(loginUser.assignments.length, 3);
    assert.equal(loginUser.assignedClassIds.length, 2);
    assert.equal(loginUser.assignedClassCodes.length, 2);
    assert.equal(loginUser.courses.length, 2);
    assert.deepEqual([...loginUser.courses].sort(), ["Mathématiques", "Physique"]);

    const classAId = fixture.classes.find((row) => row.class_code === "CLS-2A").id;
    const classAAssignments = loginUser.assignments.filter((row) => row.classId === classAId);
    assert.equal(classAAssignments.length, 2);

    const refresh = teacherPrincipalAssignmentFields(user, state);
    assert.equal(refresh.assignments.length, 3);
    assert.equal(refresh.classIds.length, 2);
    assert.equal(refresh.classCodes.length, 2);

    const classRows = fixture.classes.map((row) => ({
      id: row.id,
      classId: row.id,
      classCode: row.class_code,
      name: row.name,
    }));
    const scoped = scopeSchoolClassesForPrincipal(
      { role: "Enseignant", assignments: refresh.assignments },
      classRows,
    );
    assert.equal(scoped.length, 2);

    console.log("teacherLoginScope.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
