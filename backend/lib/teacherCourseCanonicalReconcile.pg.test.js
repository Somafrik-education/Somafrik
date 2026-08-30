"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const {
  ensureTeacherCourseCanonicalReconcile,
  CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
} = require("./teacherCourseCanonicalReconcile");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_TEACHER_COURSE_CANONICAL_IT_DATABASE ?? "somafrik_teacher_course_canonical_it",
)
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

function poolAdapter(pool) {
  return {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = {
          query: (sql, params) => client.query(sql, params),
          one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null,
          all: async (sql, params) => (await client.query(sql, params)).rows,
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

async function resetSchema(pool) {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await pool.query(PEDAGOGY_SCHEMA_SQL);
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/migrations/20260903_drop_legacy_teacher_code.sql"), "utf8"));
}

async function seedSeke(pool, { withCoursesForOtherTeacher = false } = {}) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status, profile_payload)
     VALUES ($1, 'SCH-TESTA', 'Lycée A', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb)
     RETURNING id, login_code`,
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
  const french = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-FR', 'Français', 2, 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const teacherUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'CD-LA-SK-26-00001', 'Seke', 'Kilombo', 'seke@test.cd', 'TEACHER', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'CD-LA-SK-26-00001', 'active') RETURNING id`,
    [school.rows[0].id, teacherUser.rows[0].id],
  );
  const a1 = await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
    [school.rows[0].id, teacher.rows[0].id, classA.rows[0].id, math.rows[0].id, year.rows[0].id],
  );
  const a2 = await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
    [school.rows[0].id, teacher.rows[0].id, classA.rows[0].id, french.rows[0].id, year.rows[0].id],
  );

  if (withCoursesForOtherTeacher) {
    const otherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
       VALUES ($1, 'CD-LA-AC-26-00002', 'Autre', 'Cours', 'other-course@test.cd', 'TEACHER', 'active') RETURNING id`,
      [school.rows[0].id],
    );
    const otherTeacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ($1, $2, 'CD-LA-AC-26-00002', 'active') RETURNING id`,
      [school.rows[0].id, otherUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
       VALUES ($1, $2, $3, $4, 'SCH-TESTA-CRS-0001', 2, 'active')`,
      [school.rows[0].id, classA.rows[0].id, math.rows[0].id, otherTeacher.rows[0].id],
    );
  }

  const adminUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'CD-LA-AS-26-00003', 'Admin', 'School', 'admin@test.cd', 'SCHOOL_ADMIN', 'active') RETURNING id`,
    [school.rows[0].id],
  );

  return {
    schoolId: school.rows[0].id,
    schoolLoginCode: school.rows[0].login_code,
    yearId: year.rows[0].id,
    classId: classA.rows[0].id,
    teacherId: teacher.rows[0].id,
    teacherUserId: teacherUser.rows[0].id,
    assignmentIds: [a1.rows[0].id, a2.rows[0].id].sort(),
    adminUserId: adminUser.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("teacherCourseCanonicalReconcile.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await resetSchema(pool);
    const fixture = await seedSeke(pool);
    assert.equal((await pool.query(`SELECT count(*)::int AS c FROM teacher_assignments`)).rows[0].c, 2);
    assert.equal((await pool.query(`SELECT count(*)::int AS c FROM school_courses`)).rows[0].c, 0);

    const db = poolAdapter(pool);
    const first = await ensureTeacherCourseCanonicalReconcile(db, { info() {} });
    assert.equal(first.teachersRewritten, 0);
    assert.equal(first.schoolCoursesCreated, 2);

    const seke = await pool.query(`SELECT id, teacher_code, user_id FROM teachers WHERE id = $1`, [
      fixture.teacherId,
    ]);
    assert.equal(seke.rows[0].id, fixture.teacherId);
    assert.equal(seke.rows[0].teacher_code, "CD-LA-SK-26-00001");
    assert.equal(seke.rows[0].user_id, fixture.teacherUserId);

    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'teachers' AND column_name = 'legacy_teacher_code'`,
    );
    assert.equal(columns.rowCount, 0, "legacy_teacher_code doit être DROP");

    const second = await ensureTeacherCourseCanonicalReconcile(db, { info() {} });
    assert.equal(second.teachersRewritten, 0);
    assert.equal(second.schoolCoursesCreated, 0);
    assert.equal((await pool.query(`SELECT count(*)::int AS c FROM school_courses`)).rows[0].c, 2);

    const repo = createPostgresRepository(isolatedUrl);
    repo.ready = true;
    const store = createPedagogyPgStore(repo);
    const prefet = { role: "Préfet des études", schoolCode: fixture.schoolLoginCode };
    const options = await store.listCourseSchedules(prefet, {
      projection: "course-options",
      className: "2ème A",
    });
    assert.equal(options.items.length, 2);

    const teacherPrincipal = {
      role: "Enseignant",
      schoolCode: fixture.schoolLoginCode,
      identifier: "CD-LA-SK-26-00001",
      sub: fixture.teacherUserId,
    };
    const teacherOptions = await store.listCourseSchedules(teacherPrincipal, {
      projection: "course-options",
      className: "2ème A",
    });
    assert.equal(teacherOptions.items.length, 2);

    await resetSchema(pool);
    await seedSeke(pool, { withCoursesForOtherTeacher: true });
    await assert.rejects(
      () => ensureTeacherCourseCanonicalReconcile(poolAdapter(pool), { info() {} }),
      (error) => error.code === CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
    );

    console.log("OK pg: school_courses depuis assignments UUID, zéro rewrite teacher_code, DROP legacy");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
