"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PLANNING_COURSE_OPTIONS_IT_DATABASE ?? "somafrik_planning_course_options_it")
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
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status, profile_payload)
     VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
    [country.rows[0].id],
  );
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2026-2027', 'open') RETURNING id`,
    [school.rows[0].id],
  );
  const classA = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-2A', '2ème A', 'active') RETURNING id`,
    [school.rows[0].id, year.rows[0].id],
  );
  const math = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const teacherUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-SEKE', 'Seke', 'Kilombo', 'seke@test.cd', 'TEACHER', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const otherUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-OTHER', 'Autre', 'Ens', 'other@test.cd', 'TEACHER', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'ENS-0001', 'active') RETURNING id`,
    [school.rows[0].id, teacherUser.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'ENS-0099', 'active')`,
    [school.rows[0].id, otherUser.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [school.rows[0].id, teacher.rows[0].id, classA.rows[0].id, math.rows[0].id, year.rows[0].id],
  );
  const adminUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-ADMIN', 'Admin', 'School', 'admin@test.cd', 'SCHOOL_ADMIN', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  return {
    yearId: year.rows[0].id,
    classId: classA.rows[0].id,
    teacherUserId: teacherUser.rows[0].id,
    otherUserId: otherUser.rows[0].id,
    adminUserId: adminUser.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("planningCourseOptions.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    const fixture = await seed(pool);
    const repo = createPostgresRepository(isolatedUrl);
    repo.ready = true;
    const store = createPedagogyPgStore(repo);
    const admin = { role: "Admin School", schoolCode: "CD-2026-0001", sub: fixture.adminUserId };
    const prefet = { role: "Préfet des études", schoolCode: "CD-2026-0001" };
    const teacher = {
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      identifier: "ENS-0001",
      sub: fixture.teacherUserId,
    };
    const otherTeacher = {
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      identifier: "ENS-0099",
      sub: fixture.otherUserId,
    };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "planning-course-options-it" };

    const created = await store.createSchoolCourse(
      { className: "2ème A", name: "Mathématiques", teacherId: "ENS-0001" },
      admin,
      auditMeta,
    );
    assert.ok(created.schoolCourseId);
    assert.equal(created.status === "Actif" || created.status === "active", true);

    const prefetOptions = await store.listCourseSchedules(prefet, {
      projection: "course-options",
      className: "2ème A",
    });
    assert.equal(prefetOptions.projection, "planning-course-options");
    assert.equal(prefetOptions.items.length, 1);
    assert.equal(prefetOptions.items[0].schoolCourseId, created.schoolCourseId);
    assert.equal(prefetOptions.items[0].name, "Mathématiques");
    assert.equal(prefetOptions.items[0].classId, fixture.classId);
    assert.equal(prefetOptions.items[0].academicYearId, fixture.yearId);
    assert.equal(prefetOptions.items[0].teacherId, "ENS-0001");
    assert.equal(prefetOptions.items[0].status, "active");

    const teacherOptions = await store.listCourseSchedules(teacher, {
      projection: "course-options",
      className: "2ème A",
    });
    assert.deepEqual(
      teacherOptions.items.map((row) => row.schoolCourseId),
      [created.schoolCourseId],
    );

    const otherOptions = await store.listCourseSchedules(otherTeacher, {
      projection: "course-options",
      className: "2ème A",
    });
    assert.deepEqual(otherOptions.items, []);

    const count = await pool.query(`SELECT count(*)::int AS count FROM school_courses`);
    assert.equal(count.rows[0].count, 1, "aucun school_course supplémentaire");

    console.log("OK pg: projection Planning course-options Prefet/Teacher sans recréer le cours");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
