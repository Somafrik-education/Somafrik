"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();

async function main() {
  if (!DATABASE_URL) {
    console.log("schoolCourseTeacherRepair.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    try {
      ({ Pool } = require(path.join(__dirname, "../node_modules/pg")));
    } catch {
      console.log("schoolCourseTeacherRepair.pg.test.js: SKIP (module pg absent)");
      return;
    }
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  const repairSql = fs.readFileSync(
    path.join(__dirname, "../db/repair_school_course_teacher_from_assignment.sql"),
    "utf8",
  );

  const ids = {
    school: "00000000-0000-0000-0000-000000000001",
    year: "00000000-0000-0000-0000-000000000002",
    klass: "00000000-0000-0000-0000-000000000003",
    subject: "00000000-0000-0000-0000-000000000004",
    teacher1: "00000000-0000-0000-0000-000000000005",
    teacher2: "00000000-0000-0000-0000-000000000006",
    course: "00000000-0000-0000-0000-000000000007",
    assignment1: "00000000-0000-0000-0000-000000000008",
    assignment2: "00000000-0000-0000-0000-000000000009",
  };

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE school_courses (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        class_id uuid NOT NULL,
        subject_id uuid NOT NULL,
        teacher_id uuid,
        course_code text,
        status text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TEMP TABLE teacher_assignments (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        teacher_id uuid NOT NULL,
        class_id uuid NOT NULL,
        subject_id uuid NOT NULL,
        academic_year_id uuid NOT NULL,
        status text NOT NULL
      );
      CREATE TEMP TABLE teachers (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        status text
      );
      CREATE TEMP TABLE classes (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL,
        academic_year_id uuid NOT NULL
      );
      CREATE TEMP TABLE subjects (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL
      );
      CREATE TEMP TABLE academic_years (
        id uuid PRIMARY KEY,
        school_id uuid NOT NULL
      );
    `);

    await client.query(
      `INSERT INTO teachers (id, school_id, status) VALUES ($1,$2,'active'),($3,$2,'active');
       INSERT INTO classes (id, school_id, academic_year_id) VALUES ($4,$2,$5);
       INSERT INTO subjects (id, school_id) VALUES ($6,$2);
       INSERT INTO academic_years (id, school_id) VALUES ($5,$2);`,
      [ids.teacher1, ids.school, ids.teacher2, ids.klass, ids.year, ids.subject],
    );

    await client.query(
      `INSERT INTO school_courses (id, school_id, class_id, subject_id, teacher_id, course_code, status)
       VALUES ($1,$2,$3,$4,NULL,'CRS-NULL','active');
       INSERT INTO teacher_assignments (id, school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($5,$2,$6,$3,$4,$7,'active');`,
      [ids.course, ids.school, ids.klass, ids.subject, ids.assignment1, ids.teacher1, ids.year],
    );

    const repaired = await client.query(repairSql);
    assert.equal(repaired.rowCount, 1);
    assert.equal(repaired.rows[0].id, ids.course);
    assert.equal(repaired.rows[0].teacher_id, ids.teacher1);

    const secondRun = await client.query(repairSql);
    assert.equal(secondRun.rowCount, 0, "repair must be idempotent after teacher_id is set");

    await client.query("UPDATE school_courses SET teacher_id = NULL WHERE id = $1", [ids.course]);
    await client.query(
      `INSERT INTO teacher_assignments (id, school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')`,
      [ids.assignment2, ids.school, ids.teacher2, ids.klass, ids.subject, ids.year],
    );

    const ambiguous = await client.query(repairSql);
    assert.equal(ambiguous.rowCount, 0, "two canonical active assignments must fail closed");
    const afterAmbiguous = await client.query("SELECT teacher_id FROM school_courses WHERE id = $1", [ids.course]);
    assert.equal(afterAmbiguous.rows[0].teacher_id, null);

    await client.query("ROLLBACK");
    console.log("OK pg: repair school_course teacher NULL is UUID-safe, idempotent and fail-closed");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
