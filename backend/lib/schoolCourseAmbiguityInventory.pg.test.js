"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

function loadPg() {
  try {
    return require("pg");
  } catch (first) {
    try {
      return require(path.join(__dirname, "../node_modules/pg"));
    } catch {
      throw first;
    }
  }
}

let Pool;
const {
  ensureTeacherCourseCanonicalReconcile,
  CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
} = require("./teacherCourseCanonicalReconcile");
const { inventorySchoolCourseAmbiguity } = require("./schoolCourseAmbiguityInventory");
const {
  applyProposedArchives,
  reverseArchives,
  assertProposalSafeToApply,
} = require("./schoolCourseAmbiguityRepair");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_SCHOOL_COURSE_AMBIGUITY_IT_DATABASE ?? "somafrik_school_course_ambiguity_it",
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
}

async function seedSchoolGraph(pool) {
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
  const assignedUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'ENS-0001', 'Seke', 'Kilombo', 'seke@test.cd', 'TEACHER', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const assignedTeacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'CD-2026-0001-ENS-0001', 'active') RETURNING id`,
    [school.rows[0].id, assignedUser.rows[0].id],
  );
  const otherUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'ENS-0099', 'Autre', 'Cours', 'other-course@test.cd', 'TEACHER', 'active') RETURNING id`,
    [school.rows[0].id],
  );
  const otherTeacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'CD-2026-0001-ENS-0099', 'active') RETURNING id`,
    [school.rows[0].id, otherUser.rows[0].id],
  );
  const assignment = await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
    [school.rows[0].id, assignedTeacher.rows[0].id, classA.rows[0].id, math.rows[0].id, year.rows[0].id],
  );
  return {
    schoolId: school.rows[0].id,
    yearId: year.rows[0].id,
    classId: classA.rows[0].id,
    mathId: math.rows[0].id,
    assignedTeacherId: assignedTeacher.rows[0].id,
    otherTeacherId: otherTeacher.rows[0].id,
    assignmentId: assignment.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("schoolCourseAmbiguityInventory.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  try {
    ({ Pool } = loadPg());
  } catch {
    console.log("schoolCourseAmbiguityInventory.pg.test.js: SKIP (module pg absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const db = poolAdapter(pool);

  try {
    await resetSchema(pool);
    const fixture = await seedSchoolGraph(pool);
    await pool.query(
      `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
       VALUES ($1, $2, $3, $4, 'CD-2026-0001-CRS-0001', 2, 'active')`,
      [fixture.schoolId, fixture.classId, fixture.mathId, fixture.otherTeacherId],
    );

    const otherTeacherInventory = await inventorySchoolCourseAmbiguity(db);
    assert.equal(otherTeacherInventory.blocksBoot, true);
    assert.equal(otherTeacherInventory.code, CANONICAL_SCHOOL_COURSE_AMBIGUOUS);
    assert.equal(otherTeacherInventory.duplicateGroups.length, 0);
    assert.ok(otherTeacherInventory.uniqueIndex.present);
    assert.equal(otherTeacherInventory.assignmentCollisions.length, 1);
    assert.equal(otherTeacherInventory.proposal.needsHuman, true);
    assert.throws(
      () => assertProposalSafeToApply(otherTeacherInventory.proposal),
      (error) => error.code === "SCHOOL_COURSE_AMBIGUITY_NEEDS_HUMAN",
    );
    await assert.rejects(
      () => ensureTeacherCourseCanonicalReconcile(db, { info() {} }),
      (error) =>
        error.code === CANONICAL_SCHOOL_COURSE_AMBIGUOUS &&
        /Plusieurs school_courses actifs ou collision classe\+matière/.test(error.message),
    );

    await resetSchema(pool);
    const dupFixture = await seedSchoolGraph(pool);
    await pool.query(`DROP INDEX IF EXISTS uq_school_courses_class_subject_active`);
    const keep = await pool.query(
      `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
       VALUES ($1, $2, $3, $4, 'CD-2026-0001-CRS-0001', 2, 'active') RETURNING id`,
      [dupFixture.schoolId, dupFixture.classId, dupFixture.mathId, dupFixture.assignedTeacherId],
    );
    const extra = await pool.query(
      `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
       VALUES ($1, $2, $3, $4, 'CD-2026-0001-CRS-0002', 2, 'active') RETURNING id`,
      [dupFixture.schoolId, dupFixture.classId, dupFixture.mathId, dupFixture.assignedTeacherId],
    );
    await pool.query(
      `INSERT INTO course_schedule_weekly_slots
         (school_id, academic_year_id, school_course_id, class_id, teacher_id, day_of_week, start_time, end_time, status)
       VALUES ($1, $2, $3, $4, $5, 1, '08:00', '09:00', 'active')`,
      [dupFixture.schoolId, dupFixture.yearId, keep.rows[0].id, dupFixture.classId, dupFixture.assignedTeacherId],
    );

    const dupInventory = await inventorySchoolCourseAmbiguity(db);
    assert.equal(dupInventory.blocksBoot, true);
    assert.equal(dupInventory.duplicateGroups.length, 1);
    assert.equal(dupInventory.duplicateGroups[0].active_count, 2);
    assert.equal(dupInventory.uniqueIndex.present, false);
    assert.equal(dupInventory.proposal.duplicateProposals[0].action, "archive_duplicates");
    assert.equal(dupInventory.proposal.duplicateProposals[0].keepId, keep.rows[0].id);
    assert.deepEqual(dupInventory.proposal.autoArchiveIds, [extra.rows[0].id]);
    assert.equal(dupInventory.proposal.needsHuman, false);

    await assert.rejects(
      () => ensureTeacherCourseCanonicalReconcile(db, { info() {} }),
      (error) => error.code === CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
    );

    const applied = await applyProposedArchives(db, dupInventory.proposal);
    assert.deepEqual(applied.archivedIds, [extra.rows[0].id]);
    const activeAfter = await pool.query(
      `SELECT id, status FROM school_courses WHERE class_id = $1 AND subject_id = $2 ORDER BY course_code`,
      [dupFixture.classId, dupFixture.mathId],
    );
    assert.equal(activeAfter.rows.filter((row) => row.status === "active").length, 1);
    assert.equal(activeAfter.rows.find((row) => row.id === extra.rows[0].id).status, "archived");

    const afterArchive = await ensureTeacherCourseCanonicalReconcile(db, { info() {} });
    assert.equal(afterArchive.schoolCoursesCreated, 0);

    const restored = await reverseArchives(db, applied.archivedIds);
    assert.deepEqual(restored.restoredIds, [extra.rows[0].id]);
    await assert.rejects(
      () => ensureTeacherCourseCanonicalReconcile(db, { info() {} }),
      (error) => error.code === CANONICAL_SCHOOL_COURSE_AMBIGUOUS,
    );

    console.log(
      "OK pg: inventaire collisions school_courses, fail-closed boot, archivage réversible des doublons tranchés",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
