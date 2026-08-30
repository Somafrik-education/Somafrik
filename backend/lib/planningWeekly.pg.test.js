"use strict";

/**
 * Tests PostgreSQL Planning V2 hebdomadaire — collisions, tenant, concurrence.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");
const { classifyLegacyScheduleRows, inventoryPlanningWeeklyLegacy } = require("./planningWeeklyMigrationPreflight");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PLANNING_WEEKLY_IT_DATABASE ?? "somafrik_planning_weekly_it")
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

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name, status, profile_payload)
     VALUES ($1, 'CD-2026-0001', 'CD-PL-26-001', 'Lycée A', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id, login_code`,
    [country.rows[0].id],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name, status)
     VALUES ($1, 'BI-2026-0001', 'BI-PL-26-001', 'Lycée B', 'active') RETURNING id, login_code`,
    [country.rows[0].id],
  );
  const yearOpen = await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     VALUES ($1, '2026-2027', 'open') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const yearPrev = await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     VALUES ($1, '2026-2027', 'open') RETURNING id`,
    [schoolB.rows[0].id],
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
  const classPrev = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-2A-PREV', '2ème A-2025', 'active') RETURNING id`,
    [schoolA.rows[0].id, yearPrev.rows[0].id],
  );
  const classOtherTenant = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-BI', '2ème A', 'active') RETURNING id`,
    [schoolB.rows[0].id, yearB.rows[0].id],
  );
  const math = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const mathB = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-MATH-BI', 'Mathématiques', 2, 'active') RETURNING id`,
    [schoolB.rows[0].id],
  );
  const teacherUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-SEKE', 'Seke', 'Kilombo', 'seke@test.cd', 'TEACHER', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'ENS-SEKE', 'active') RETURNING id`,
    [schoolA.rows[0].id, teacherUser.rows[0].id],
  );
  const teacherB = await pool.query(
    `INSERT INTO teachers (school_id, teacher_code, status)
     VALUES ($1, 'ENS-BI', 'active') RETURNING id`,
    [schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active'), ($1, $2, $6, $4, $5, 'active')`,
    [schoolA.rows[0].id, teacher.rows[0].id, classA.rows[0].id, math.rows[0].id, yearOpen.rows[0].id, classB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolA.rows[0].id, teacher.rows[0].id, classPrev.rows[0].id, math.rows[0].id, yearPrev.rows[0].id],
  );
  const adminUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-ADMIN', 'Admin', 'School', 'admin@test.cd', 'SCHOOL_ADMIN', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  return {
    schoolA: schoolA.rows[0].id,
    schoolB: schoolB.rows[0].id,
    yearOpen: yearOpen.rows[0].id,
    yearPrev: yearPrev.rows[0].id,
    yearB: yearB.rows[0].id,
    classA: classA.rows[0].id,
    classB: classB.rows[0].id,
    classPrev: classPrev.rows[0].id,
    classOtherTenant: classOtherTenant.rows[0].id,
    math: math.rows[0].id,
    mathB: mathB.rows[0].id,
    teacher: teacher.rows[0].id,
    teacherB: teacherB.rows[0].id,
    adminUser: adminUser.rows[0].id,
    schoolACode: String(schoolA.rows[0].login_code ?? "CD-PL-26-001").trim().toUpperCase(),
    schoolBCode: String(schoolB.rows[0].login_code ?? "BI-PL-26-001").trim().toUpperCase(),
    teacherUserCode: "USR-SEKE",
  };
}

async function createMathCourse(store, admin, auditMeta, className) {
  return store.createSchoolCourse(
    { className, name: "Mathématiques", teacherId: "USR-SEKE" },
    admin,
    auditMeta,
  );
}

async function main() {
  if (!DATABASE_URL) {
    console.log("planningWeekly.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(PEDAGOGY_SCHEMA_SQL);

    const fixture = await seed(pool);
    const repo = createPostgresRepository(isolatedUrl);
    repo.ready = true;
    const store = createPedagogyPgStore(repo);
    const admin = { role: "Admin School", schoolCode: fixture.schoolACode, sub: fixture.adminUser };
    const otherTenant = { role: "Admin School", schoolCode: fixture.schoolBCode };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "planning-weekly-it" };

    const courseA = await createMathCourse(store, admin, auditMeta, "2ème A");
    const courseB = await createMathCourse(store, admin, auditMeta, "2ème B");
    const coursePrev = await createMathCourse(store, admin, auditMeta, "2ème A-2025");

    const created = await store.createCourseSchedule(
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
    assert.equal(created.schoolCourseId, courseA.schoolCourseId);
    assert.equal(created.academicYearId, fixture.yearOpen);
    assert.equal(created.teacherId, fixture.teacher);
    assert.equal(created.dayOfWeek, 1);

    const reloaded = await pool.query(`SELECT * FROM course_schedule_weekly_slots WHERE id = $1`, [created.id]);
    assert.equal(reloaded.rowCount, 1);
    assert.equal(Number(reloaded.rows[0].day_of_week), 1);

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: courseA.schoolCourseId,
            academicYearId: fixture.yearOpen,
            dayOfWeek: 1,
            startTime: "08:30",
            endTime: "09:30",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT,
    );

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: courseB.schoolCourseId,
            academicYearId: fixture.yearOpen,
            dayOfWeek: 1,
            startTime: "08:30",
            endTime: "09:30",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT,
    );

    const adjacent = await store.createCourseSchedule(
      {
        schoolCourseId: courseA.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "10:00",
      },
      admin,
      auditMeta,
    );
    assert.equal(adjacent.startTime, "09:00");

    const tuesday = await store.createCourseSchedule(
      {
        schoolCourseId: courseA.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 2,
        startTime: "08:30",
        endTime: "09:30",
      },
      admin,
      auditMeta,
    );
    assert.equal(tuesday.dayOfWeek, 2);

    const prevYear = await store.createCourseSchedule(
      {
        schoolCourseId: coursePrev.schoolCourseId,
        academicYearId: fixture.yearPrev,
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "09:00",
      },
      admin,
      auditMeta,
    );
    assert.equal(prevYear.academicYearId, fixture.yearPrev);

    const listedOpen = await store.listCourseSchedules(admin, { academicYearId: fixture.yearOpen });
    assert.ok(listedOpen.every((row) => row.academicYearId === fixture.yearOpen));
    assert.ok(!listedOpen.some((row) => row.id === prevYear.id));

    const otherCourse = await pool.query(
      `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
       VALUES ($1, $2, $3, $4, 'BI-CRS-1', 1, 'active') RETURNING id`,
      [fixture.schoolB, fixture.classOtherTenant, fixture.mathB, fixture.teacherB],
    );
    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: otherCourse.rows[0].id,
            academicYearId: fixture.yearOpen,
            dayOfWeek: 3,
            startTime: "08:00",
            endTime: "09:00",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND || error.code === PEDAGOGY_ERROR.TENANT_MISMATCH,
    );

    await pool.query(`UPDATE school_courses SET status = 'archived' WHERE id = $1`, [courseB.schoolCourseId]);
    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: courseB.schoolCourseId,
            academicYearId: fixture.yearOpen,
            dayOfWeek: 3,
            startTime: "10:00",
            endTime: "11:00",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.SCHOOL_COURSE_INACTIVE,
    );
    await pool.query(`UPDATE school_courses SET status = 'active' WHERE id = $1`, [courseB.schoolCourseId]);

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: courseA.schoolCourseId,
            academicYearId: fixture.yearOpen,
            dayOfWeek: 9,
            startTime: "11:00",
            endTime: "12:00",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.INVALID_DAY_OF_WEEK,
    );

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: courseA.schoolCourseId,
            academicYearId: fixture.yearOpen,
            dayOfWeek: 3,
            startTime: "12:00",
            endTime: "11:00",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.INVALID_TIME_RANGE,
    );

    await assert.rejects(
      () =>
        store.updateCourseSchedule(
          created.id,
          { startTime: "08:30", endTime: "09:30" },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT,
    );

    const cancelled = await store.deleteCourseSchedule(created.id, admin, auditMeta);
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.deleted, false);
    const stillThere = await pool.query(`SELECT status FROM course_schedule_weekly_slots WHERE id = $1`, [created.id]);
    assert.equal(stillThere.rows[0].status, "cancelled");
    const activeList = await store.listCourseSchedules(admin, { academicYearId: fixture.yearOpen });
    assert.ok(!activeList.some((row) => row.id === created.id));
    const audit = await pool.query(
      `SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'cancel_course_schedule'`,
      [created.id],
    );
    assert.ok(audit.rowCount >= 1);

    const rec = await store.listCourseSchedules(admin, {
      academicYearId: fixture.yearOpen,
      schoolCourseId: courseA.schoolCourseId,
      from: "2026-09-01",
      to: "2026-09-30",
    });
    assert.equal(rec.projection, "occurrences");
    const mondays = rec.items.filter((row) => row.dayOfWeek === 1 && row.startTime === "09:00");
    assert.equal(mondays.length, 4);

    const concurrentA = store.createCourseSchedule(
      {
        schoolCourseId: courseB.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 5,
        startTime: "08:00",
        endTime: "09:00",
      },
      admin,
      auditMeta,
    );
    const concurrentB = store.createCourseSchedule(
      {
        schoolCourseId: courseA.schoolCourseId,
        academicYearId: fixture.yearOpen,
        dayOfWeek: 5,
        startTime: "08:00",
        endTime: "09:00",
      },
      admin,
      auditMeta,
    );
    const settled = await Promise.allSettled([concurrentA, concurrentB]);
    const fulfilled = settled.filter((row) => row.status === "fulfilled");
    const rejected = settled.filter(
      (row) => row.status === "rejected" && row.reason?.code === PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT,
    );
    assert.equal(fulfilled.length, 1, `concurrence: ${JSON.stringify(settled.map((row) => row.status))}`);
    assert.equal(rejected.length, 1);

    const teacherRows = await store.listCourseSchedules(
      { role: "Enseignant", schoolCode: fixture.schoolACode, sub: fixture.adminUser, identifier: fixture.teacherUserCode },
      { academicYearId: fixture.yearOpen },
    );
    assert.ok(Array.isArray(teacherRows));
    assert.ok(teacherRows.every((row) => row.teacherId === fixture.teacher));

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: courseA.schoolCourseId,
            academicYearId: fixture.yearOpen,
            dayOfWeek: 3,
            startTime: "14:00",
            endTime: "15:00",
          },
          otherTenant,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.TENANT_MISMATCH || error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND,
    );

    await pool.query(
      `INSERT INTO course_schedule_slots
         (school_id, class_id, class_name, subject_name, teacher_id, slot_kind, starts_at, ends_at)
       VALUES
         ($1, $2, '2ème A', 'Mathématiques', $3, 'course', '2026-09-07T07:00:00Z', '2026-09-07T08:00:00Z'),
         ($1, $2, '2ème A', 'Mathématiques', NULL, 'course', '2026-09-08T07:00:00Z', '2026-09-08T08:00:00Z'),
         ($1, $2, '2ème A', 'Latin', $3, 'course', '2026-09-09T07:00:00Z', '2026-09-09T08:00:00Z'),
         ($1, $2, '2ème A', 'Mathématiques', $3, 'exam', '2026-09-10T07:00:00Z', '2026-09-10T08:00:00Z')`,
      [fixture.schoolA, fixture.classA, fixture.teacher],
    );
    const legacy = await pool.query(`SELECT * FROM course_schedule_slots`);
    const classified = classifyLegacyScheduleRows(legacy.rows, {
      timeZone: "Africa/Kinshasa",
      classById: { [fixture.classA]: { id: fixture.classA, academic_year_id: fixture.yearOpen } },
      yearById: { [fixture.yearOpen]: { id: fixture.yearOpen, school_id: fixture.schoolA } },
      subjects: [{ id: fixture.math, school_id: fixture.schoolA, name: "Mathématiques" }],
      schoolCourses: [
        {
          id: courseA.schoolCourseId,
          school_id: fixture.schoolA,
          class_id: fixture.classA,
          subject_id: fixture.math,
          teacher_id: fixture.teacher,
          status: "active",
        },
      ],
    });
    assert.equal(classified.summary.MIGRATABLE, 1);
    assert.equal(classified.summary.AMBIGUOUS, 1);
    assert.equal(classified.summary.ORPHAN, 1);
    assert.equal(classified.summary.EXAM, 1);
    assert.equal(
      classified.summary.MIGRATABLE + classified.summary.AMBIGUOUS + classified.summary.ORPHAN + classified.summary.EXAM,
      4,
    );

    const weeklyBefore = await pool.query(`SELECT count(*)::int AS count FROM course_schedule_weekly_slots`);
    const inventoried = await inventoryPlanningWeeklyLegacy({
      one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
      all: async (sql, params) => (await pool.query(sql, params)).rows,
    });
    assert.equal(inventoried.skipped, false);
    assert.equal(inventoried.summary.MIGRATABLE, 1);
    assert.equal(inventoried.summary.AMBIGUOUS, 1);
    assert.equal(inventoried.summary.ORPHAN, 1);
    assert.equal(inventoried.summary.EXAM, 1);
    const weeklyAfter = await pool.query(`SELECT count(*)::int AS count FROM course_schedule_weekly_slots`);
    assert.equal(
      weeklyAfter.rows[0].count,
      weeklyBefore.rows[0].count,
      "preflight inventaire : aucune ligne weekly insérée",
    );

    console.log("planningWeekly.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
