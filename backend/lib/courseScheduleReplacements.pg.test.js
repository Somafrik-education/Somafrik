"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(
  process.env.SOMAFRIK_PLANNING_REPLACEMENTS_IT_DATABASE ?? "somafrik_planning_replacements_it",
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

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status, profile_payload)
     VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
    [country.rows[0].id],
  );
  const yearOpen = await pool.query(
    `INSERT INTO academic_years (school_id, name, status, start_date, end_date)
     VALUES ($1, '2026-2027', 'open', '2026-08-01', '2027-07-31') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const classA = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-2A', '2ème A', 'active') RETURNING id`,
    [schoolA.rows[0].id, yearOpen.rows[0].id],
  );
  const classB = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-2B', '2ème B', 'active') RETURNING id`,
    [schoolA.rows[0].id, yearOpen.rows[0].id],
  );
  const math = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const french = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-FR', 'Français', 2, 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const sekeUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-SEKE', 'Seke', 'Kilombo', 'seke@test.cd', 'TEACHER', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const kabeyaUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-KABEYA', 'Jean', 'Kabeya', 'kabeya@test.cd', 'TEACHER', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const otherUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-OTHER', 'Paul', 'Mbala', 'mbala@test.cd', 'TEACHER', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const seke = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, status)
     VALUES ($1, $2, 'ENS-SEKE', 'Mathématiques', 'active') RETURNING id`,
    [schoolA.rows[0].id, sekeUser.rows[0].id],
  );
  const kabeya = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, status)
     VALUES ($1, $2, 'ENS-KABEYA', 'Français', 'active') RETURNING id`,
    [schoolA.rows[0].id, kabeyaUser.rows[0].id],
  );
  const mbala = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, speciality, status)
     VALUES ($1, $2, 'ENS-MBALA', 'Histoire', 'active') RETURNING id`,
    [schoolA.rows[0].id, otherUser.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active'), ($1, $6, $7, $8, $5, 'active')`,
    [
      schoolA.rows[0].id,
      seke.rows[0].id,
      classA.rows[0].id,
      math.rows[0].id,
      yearOpen.rows[0].id,
      kabeya.rows[0].id,
      classB.rows[0].id,
      french.rows[0].id,
    ],
  );
  const adminUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-ADMIN', 'Admin', 'School', 'admin@test.cd', 'SCHOOL_ADMIN', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  return {
    schoolA: schoolA.rows[0].id,
    yearOpen: yearOpen.rows[0].id,
    seke: seke.rows[0].id,
    kabeya: kabeya.rows[0].id,
    mbala: mbala.rows[0].id,
    adminUser: adminUser.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("courseScheduleReplacements.pg.test.js: SKIP (DATABASE_URL absent)");
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
    const admin = { role: "Admin School", schoolCode: "CD-2026-0001", sub: fixture.adminUser };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "replacements-it" };

    const courseA = await store.createSchoolCourse(
      { className: "2ème A", name: "Mathématiques", teacherId: "ENS-SEKE" },
      admin,
      auditMeta,
    );
    const courseB = await store.createSchoolCourse(
      { className: "2ème B", name: "Français", teacherId: "ENS-KABEYA" },
      admin,
      auditMeta,
    );
    const slotA = await store.createCourseSchedule(
      {
        schoolCourseId: courseA.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "09:00",
      },
      admin,
      auditMeta,
    );
    const slotB = await store.createCourseSchedule(
      {
        schoolCourseId: courseB.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "09:00",
      },
      admin,
      auditMeta,
    );

    const teacherBefore = await pool.query(`SELECT teacher_id FROM school_courses WHERE id = $1`, [courseA.schoolCourseId]);
    const weeklyBefore = await pool.query(`SELECT teacher_id FROM course_schedule_weekly_slots WHERE id = $1`, [slotA.id]);
    const assignmentBefore = await pool.query(
      `SELECT count(*)::int AS c FROM teacher_assignments WHERE teacher_id = $1 AND status = 'active'`,
      [fixture.seke],
    );

    const created = await store.createCourseScheduleReplacement(
      {
        weeklySlotId: slotA.id,
        occurrenceDate: "2026-08-24",
        substituteTeacherId: fixture.mbala,
        reason: "Absence Seke",
      },
      admin,
      auditMeta,
    );
    assert.equal(created.substituteTeacherId, fixture.mbala);
    assert.equal(created.originalTeacherId, fixture.seke);

    const badDay = await store
      .createCourseScheduleReplacement(
        { weeklySlotId: slotA.id, occurrenceDate: "2026-08-25", substituteTeacherId: fixture.mbala },
        admin,
        auditMeta,
      )
      .catch((error) => error);
    assert.equal(badDay.code, PEDAGOGY_ERROR.REPLACEMENT_WEEKDAY_MISMATCH);

    const alreadyTeaching = await store
      .createCourseScheduleReplacement(
        { weeklySlotId: slotA.id, occurrenceDate: "2026-08-31", substituteTeacherId: fixture.kabeya },
        admin,
        auditMeta,
      )
      .catch((error) => error);
    assert.equal(alreadyTeaching.code, PEDAGOGY_ERROR.SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT);

    const firstSub = await store.createCourseScheduleReplacement(
      {
        weeklySlotId: slotB.id,
        occurrenceDate: "2026-08-31",
        substituteTeacherId: fixture.mbala,
      },
      admin,
      auditMeta,
    );
    const alreadySub = await store
      .createCourseScheduleReplacement(
        {
          weeklySlotId: slotA.id,
          occurrenceDate: "2026-08-31",
          substituteTeacherId: fixture.mbala,
        },
        admin,
        auditMeta,
      )
      .catch((error) => error);
    assert.equal(alreadySub.code, PEDAGOGY_ERROR.SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT);

    const projection = await store.listCourseSchedules(admin, { from: "2026-08-24", to: "2026-08-24" });
    const occ = projection.items.find((row) => row.scheduleId === slotA.id);
    assert.equal(occ.replacement, true);
    assert.equal(occ.replacementId, created.id);
    assert.match(String(occ.teacher || occ.teacherName), /Mbala|Kabeya|Paul/i);
    assert.match(String(occ.originalTeacher), /Seke/i);

    await store.cancelCourseScheduleReplacement(created.id, admin, auditMeta);
    const restored = await store.listCourseSchedules(admin, { from: "2026-08-24", to: "2026-08-24" });
    const occ2 = restored.items.find((row) => row.scheduleId === slotA.id);
    assert.equal(Boolean(occ2.replacement), false);
    assert.match(String(occ2.teacher || occ2.teacherName), /Seke/i);

    const teacherAfter = await pool.query(`SELECT teacher_id FROM school_courses WHERE id = $1`, [courseA.schoolCourseId]);
    const weeklyAfter = await pool.query(`SELECT teacher_id FROM course_schedule_weekly_slots WHERE id = $1`, [slotA.id]);
    const assignmentAfter = await pool.query(
      `SELECT count(*)::int AS c FROM teacher_assignments WHERE teacher_id = $1 AND status = 'active'`,
      [fixture.seke],
    );
    assert.equal(teacherAfter.rows[0].teacher_id, teacherBefore.rows[0].teacher_id);
    assert.equal(weeklyAfter.rows[0].teacher_id, weeklyBefore.rows[0].teacher_id);
    assert.equal(assignmentAfter.rows[0].c, assignmentBefore.rows[0].c);

    const concurrentBody = {
      weeklySlotId: slotA.id,
      occurrenceDate: "2026-09-07",
      substituteTeacherId: fixture.mbala,
    };
    const results = await Promise.allSettled([
      store.createCourseScheduleReplacement(concurrentBody, admin, auditMeta),
      store.createCourseScheduleReplacement(concurrentBody, admin, auditMeta),
    ]);
    const ok = results.filter((row) => row.status === "fulfilled").length;
    const denied = results.filter(
      (row) =>
        row.status === "rejected" &&
        (row.reason?.code === PEDAGOGY_ERROR.REPLACEMENT_OCCURRENCE_CONFLICT ||
          row.reason?.code === PEDAGOGY_ERROR.SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT),
    ).length;
    assert.equal(ok, 1);
    assert.equal(denied, 1);

    assert.ok(firstSub.id);
    console.log("OK courseScheduleReplacements.pg.test.js: occurrence, weekday, conflits, projection, concurrence");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
