"use strict";

/**
 * Intégration PostgreSQL — pédagogie canonique :
 * références, affectations, année fermée, notes, présences, audit rollback, concurrence.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");
const { createTxAdapter } = require("../db/txAdapter");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const PEDAGOGY_IT_DATABASE = String(process.env.SOMAFRIK_PEDAGOGY_IT_DATABASE ?? "somafrik_pedagogy_it")
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

function failAuditWrites(store) {
  const original = store.withTransaction.bind(store);
  store.withTransaction = (fn) =>
    original(async (tx) => {
      tx.recordPedagogyAudit = async () => {
        throw new Error("audit write failed");
      };
      return fn(tx);
    });
  return () => {
    store.withTransaction = original;
  };
}

async function seedFixture(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'Lycée A', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'BI-2026-0001', 'Lycée B', 'active') RETURNING id`,
    [country.rows[0].id],
  );
  const openYear = await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const closedYear = await pool.query(
    `INSERT INTO academic_years (school_id, name, status)
     VALUES ($1, '2024-2025', 'closed') RETURNING id`,
    [schoolA.rows[0].id],
  );
  await pool.query(
    `INSERT INTO evaluation_types (school_id, code, name, status, display_order)
     VALUES ($1, 'devoir', 'Devoir', 'active', 20)`,
    [schoolA.rows[0].id],
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-6A', '6ème A', 'active') RETURNING id`,
    [schoolA.rows[0].id, openYear.rows[0].id],
  );
  const closedClass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-5Z', '5ème Z', 'active') RETURNING id`,
    [schoolA.rows[0].id, closedYear.rows[0].id],
  );
  const term = await pool.query(
    `INSERT INTO terms (academic_year_id, name, status)
     VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
    [openYear.rows[0].id],
  );
  const math = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const physics = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
     VALUES ($1, 'SUB-PHY', 'Physique', 2, 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const teacherUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-ENS-PG', 'Paul', 'Prof', 'ens-pg@test.cd', 'TEACHER', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, 'ENS-PG-001', 'active') RETURNING id`,
    [schoolA.rows[0].id, teacherUser.rows[0].id],
  );
  const teacherNoAssign = await pool.query(
    `INSERT INTO teachers (school_id, teacher_code, status)
     VALUES ($1, 'ENS-PG-002', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const klassB = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-PG-ATT-B', '6ème B-ATT', 'active') RETURNING id`,
    [schoolA.rows[0].id, openYear.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolA.rows[0].id, teacher.rows[0].id, klass.rows[0].id, math.rows[0].id, openYear.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'inactive')`,
    [schoolA.rows[0].id, teacher.rows[0].id, klass.rows[0].id, physics.rows[0].id, openYear.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolA.rows[0].id, teacherNoAssign.rows[0].id, klassB.rows[0].id, math.rows[0].id, openYear.rows[0].id],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'CD-2026-0001-STU-PG-01', 'Awa', 'Test', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const outsider = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'BI-2026-0001-STU-01', 'Jean', 'Other', 'active') RETURNING id`,
    [schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [schoolA.rows[0].id, student.rows[0].id, klass.rows[0].id, openYear.rows[0].id],
  );
  const adminUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-ADMIN-PG', 'Admin', 'School', 'admin-pg@test.cd', 'SCHOOL_ADMIN', 'active') RETURNING id`,
    [schoolA.rows[0].id],
  );

  return {
    schoolA: schoolA.rows[0].id,
    schoolB: schoolB.rows[0].id,
    klass: klass.rows[0].id,
    klassB: klassB.rows[0].id,
    closedClass: closedClass.rows[0].id,
    openYear: openYear.rows[0].id,
    closedYear: closedYear.rows[0].id,
    term: term.rows[0].id,
    math: math.rows[0].id,
    physics: physics.rows[0].id,
    teacher: teacher.rows[0].id,
    teacherUser: teacherUser.rows[0].id,
    teacherNoAssign: teacherNoAssign.rows[0].id,
    student: student.rows[0].id,
    outsider: outsider.rows[0].id,
    adminUser: adminUser.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("pedagogyRepository.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, PEDAGOGY_IT_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(PEDAGOGY_SCHEMA_SQL);

    const fixture = await seedFixture(pool);
    const repo = createPostgresRepository(isolatedUrl);
    repo.ready = true;
    const store = createPedagogyPgStore(repo);
    const admin = {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      sub: fixture.adminUser,
    };
    const teacherPrincipal = {
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      sub: "ENS-PG-001",
    };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "pedagogy-it" };

    const course = await store.createSchoolCourse(
      {
        className: "6ème A",
        name: "Mathématiques",
        coefficient: 2,
      },
      admin,
      auditMeta,
    );
    assert.ok(course.id);
    assert.equal(course.className, "6ème A");
    assert.equal(course.name, "Mathématiques");

    await assert.rejects(
      () =>
        store.createSchoolCourse(
          { className: "Classe Fantôme", name: "Mathématiques" },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND,
    );

    await assert.rejects(
      () =>
        store.createSchoolCourse(
          { className: "6ème A", name: "Matière Inventée" },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND,
    );

    const subjectsBefore = await pool.query(`SELECT count(*)::int AS count FROM subjects`);
    assert.equal(subjectsBefore.rows[0].count, 2, "aucune matière auto-créée");

    await assert.rejects(
      () =>
        store.createSchoolCourse(
          { className: "5ème Z", name: "Mathématiques" },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.ACADEMIC_YEAR_CLOSED,
    );

    await assert.rejects(
      () =>
        store.createSchoolCourse(
          {
            className: "6ème A",
            name: "Mathématiques",
            teacherId: "ENS-PG-002",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );

    await assert.rejects(
      () =>
        store.createSchoolCourse(
          {
            className: "6ème A",
            name: "Physique",
            teacherId: "ENS-PG-001",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );

    await assert.rejects(
      () =>
        store.createSchoolCourse(
          {
            className: "6ème A",
            name: "Mathématiques",
            teacherId: "ENS-INCONNU",
          },
          admin,
          auditMeta,
        ),
      (error) => error.statusCode === 404 && !error.code,
    );

    const courseWithTeacher = await store.updateSchoolCourse(
      course.id,
      { teacherId: "ENS-PG-001" },
      admin,
      auditMeta,
    );
    assert.equal(courseWithTeacher.teacherId, "ENS-PG-001");

    await assert.rejects(
      () =>
        store.createSchoolCourse(
          { className: "6ème A", name: "Physique" },
          { role: "Admin School", schoolCode: "BI-2026-0001" },
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.TENANT_MISMATCH || error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND,
    );

    const slotA = await store.createCourseSchedule(
      {
        schoolCourseId: course.schoolCourseId,
        academicYearId: fixture.openYear,
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "09:00",
      },
      admin,
      auditMeta,
    );
    assert.equal(slotA.className, "6ème A");
    assert.equal(slotA.schoolCourseId, course.schoolCourseId);
    assert.equal(slotA.dayOfWeek, 1);
    assert.equal(slotA.startTime, "08:00");
    const slotRow = await pool.query(
      `SELECT class_id, school_course_id, academic_year_id FROM course_schedule_weekly_slots WHERE id = $1`,
      [slotA.id],
    );
    assert.equal(slotRow.rows[0].class_id, fixture.klass);
    assert.equal(slotRow.rows[0].school_course_id, course.schoolCourseId);
    assert.equal(slotRow.rows[0].academic_year_id, fixture.openYear);

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            className: "Classe Inconnue",
            subject: "Mathématiques",
            dayOfWeek: 2,
            startTime: "08:00",
            endTime: "09:00",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND,
    );

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: "00000000-0000-0000-0000-000000000099",
            academicYearId: fixture.openYear,
            dayOfWeek: 2,
            startTime: "08:00",
            endTime: "09:00",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.COURSE_NOT_FOUND,
    );

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: course.schoolCourseId,
            academicYearId: fixture.openYear,
            dayOfWeek: 0,
            startTime: "08:00",
            endTime: "09:00",
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
            schoolCourseId: course.schoolCourseId,
            academicYearId: fixture.openYear,
            dayOfWeek: 1,
            startTime: "09:00",
            endTime: "08:00",
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.INVALID_TIME_RANGE,
    );

    await assert.rejects(
      () =>
        store.createCourseSchedule(
          {
            schoolCourseId: course.schoolCourseId,
            academicYearId: fixture.openYear,
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
        schoolCourseId: course.schoolCourseId,
        academicYearId: fixture.openYear,
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
        schoolCourseId: course.schoolCourseId,
        academicYearId: fixture.openYear,
        dayOfWeek: 2,
        startTime: "08:00",
        endTime: "09:00",
      },
      admin,
      auditMeta,
    );
    assert.equal(tuesday.dayOfWeek, 2);

    const klassB = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-6B', '6ème B', 'active') RETURNING id`,
      [fixture.schoolA, fixture.openYear],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [fixture.schoolA, fixture.teacher, klassB.rows[0].id, fixture.math, fixture.openYear],
    );

    const courseB = await store.createSchoolCourse(
      {
        className: "6ème B",
        name: "Mathématiques",
        teacherId: "ENS-PG-001",
      },
      admin,
      auditMeta,
    );

    const physicsId = (
      await pool.query(`SELECT id FROM subjects WHERE subject_code = 'SUB-PHY' LIMIT 1`)
    ).rows[0].id;
    const physicsCourse = await pool.query(
      `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
       VALUES ($1, $2, $3, $4, 'CD-2026-0001-CRS-PHY', 1, 'active') RETURNING id`,
      [fixture.schoolA, klassB.rows[0].id, physicsId, fixture.teacher],
    );

    const scheduleWithTeacher = await store.createCourseSchedule(
      {
        schoolCourseId: course.schoolCourseId,
        academicYearId: fixture.openYear,
        dayOfWeek: 4,
        startTime: "08:00",
        endTime: "09:00",
      },
      admin,
      auditMeta,
    );
    assert.equal(scheduleWithTeacher.className, "6ème A");
    assert.equal(scheduleWithTeacher.dayOfWeek, 4);

    await assert.rejects(
      () =>
        store.updateCourseSchedule(
          scheduleWithTeacher.id,
          { schoolCourseId: physicsCourse.rows[0].id },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED,
    );

    const patchedSchedule = await store.updateCourseSchedule(
      scheduleWithTeacher.id,
      { schoolCourseId: courseB.schoolCourseId },
      admin,
      auditMeta,
    );
    assert.equal(patchedSchedule.className, "6ème B");
    const patchedRow = await pool.query(
      `SELECT class_id, school_course_id FROM course_schedule_weekly_slots WHERE id = $1`,
      [scheduleWithTeacher.id],
    );
    assert.equal(patchedRow.rows[0].class_id, klassB.rows[0].id, "class_id mis à jour au PATCH");
    assert.equal(patchedRow.rows[0].school_course_id, courseB.schoolCourseId);

    const evaluation = await store.createEvaluation(
      {
        id: "EVAL-PG-LOT5",
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Devoir intégration",
        maxScore: 20,
        schoolCode: "CD-2026-0001",
        teacherId: "ENS-PG-001",
        evaluationType: "Devoir",
      },
      admin,
      auditMeta,
    );
    assert.ok(evaluation.id);

    const draftGrade = await store.upsertSchoolGrade(
      {
        evaluationId: evaluation.id,
        studentId: "CD-2026-0001-STU-PG-01",
        teacherId: "ENS-PG-001",
        value: 12,
        scale: 20,
      },
      admin,
      auditMeta,
    );
    assert.equal(Number(draftGrade.score ?? draftGrade.value), 12, "NOTES-P1 : saisie sur brouillon");

    const validated = await store.updateEvaluation(
      evaluation.id,
      { status: "Validée" },
      admin,
      auditMeta,
    );
    assert.equal(validated.status, "Validée");

    const schoolsBeforeEvalForge = await pool.query(`SELECT count(*)::int AS count FROM schools`);
    const schoolCountBefore = schoolsBeforeEvalForge.rows[0].count;
    const forgedEval = await store.createEvaluation(
      {
        id: "EVAL-FORGE-TENANT",
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "Tenant scellé",
        maxScore: 20,
        schoolCode: "BI-2026-0001",
        teacherId: "ENS-PG-001",
        evaluationType: "Devoir",
      },
      admin,
      auditMeta,
    );
    assert.ok(forgedEval.id);
    const forgedEvalRow = await pool.query(
      `SELECT s.school_code FROM evaluations e JOIN schools s ON s.id = e.school_id WHERE e.legacy_json_id = $1`,
      ["EVAL-FORGE-TENANT"],
    );
    assert.equal(forgedEvalRow.rows[0].school_code, "CD-2026-0001");
    const schoolsAfterEvalForge = await pool.query(`SELECT count(*)::int AS count FROM schools`);
    assert.equal(schoolsAfterEvalForge.rows[0].count, schoolCountBefore, "schoolCode client ignoré");

    const biYear = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [fixture.schoolB],
    );
    const biClass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-BI', '6ème BI', 'active') RETURNING id`,
      [fixture.schoolB, biYear.rows[0].id],
    );
    const biSubject = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-BI-MATH', 'Mathématiques', 1, 'active') RETURNING id`,
      [fixture.schoolB],
    );
    const biTerm = await pool.query(
      `INSERT INTO terms (academic_year_id, name, status)
       VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
      [biYear.rows[0].id],
    );
    const biEvaluation = await pool.query(
      `INSERT INTO evaluations (
         school_id, class_id, subject_id, term_id, title, evaluation_type,
         evaluation_date, max_score, coefficient, status, active, legacy_json_id
       ) VALUES ($1,$2,$3,$4,'Éval BI','test','2026-01-01',20,1,'draft',true,'EVAL-BI-FOREIGN')
       RETURNING id, legacy_json_id, title`,
      [fixture.schoolB, biClass.rows[0].id, biSubject.rows[0].id, biTerm.rows[0].id],
    );

    await assert.rejects(
      () =>
        store.updateEvaluation(
          biEvaluation.rows[0].id,
          { title: "Compromis UUID" },
          admin,
          auditMeta,
        ),
      (error) =>
        error.code === PEDAGOGY_ERROR.EVALUATION_NOT_FOUND || error.statusCode === 404,
    );

    await assert.rejects(
      () =>
        store.createEvaluation(
          {
            id: biEvaluation.rows[0].legacy_json_id,
            className: "6ème A",
            subject: "Mathématiques",
            period: "Trimestre 1",
            title: "Compromis legacy",
            teacherId: "ENS-PG-001",
            evaluationType: "Devoir",
          },
          admin,
          auditMeta,
        ),
      (error) =>
        error.code === PEDAGOGY_ERROR.EVALUATION_NOT_FOUND || error.statusCode === 404,
    );

    const biEvalAfter = await pool.query(`SELECT title FROM evaluations WHERE id = $1`, [
      biEvaluation.rows[0].id,
    ]);
    assert.equal(biEvalAfter.rows[0].title, "Éval BI", "évaluation BI inchangée");

    const customEval = await pool.query(
      `INSERT INTO evaluations (
         school_id, class_id, subject_id, teacher_id, term_id,
         title, evaluation_type, evaluation_date, max_score, coefficient,
         status, active, legacy_json_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, legacy_json_id, updated_at`,
      [
        fixture.schoolA,
        fixture.klass,
        fixture.math,
        fixture.teacher,
        fixture.term,
        "Éval PATCH partiel",
        "examen",
        "2026-06-15",
        10,
        2,
        "published",
        false,
        "EVAL-PATCH-PARTIAL",
      ],
    );
    const evalBeforePatch = customEval.rows[0];
    await store.updateEvaluation(
      "EVAL-PATCH-PARTIAL",
      { title: "Nouveau titre seul" },
      admin,
      auditMeta,
    );
    const evalAfterPatch = await pool.query(`SELECT * FROM evaluations WHERE id = $1`, [
      evalBeforePatch.id,
    ]);
    const patched = evalAfterPatch.rows[0];
    assert.equal(patched.title, "Nouveau titre seul");
    assert.equal(Number(patched.max_score), 10);
    assert.equal(Number(patched.coefficient), 2);
    assert.equal(patched.status, "published");
    assert.equal(patched.evaluation_type, "examen");
    const patchedDate =
      patched.evaluation_date instanceof Date
        ? patched.evaluation_date.toISOString().slice(0, 10)
        : String(patched.evaluation_date).slice(0, 10);
    assert.equal(patchedDate, "2026-06-15");
    assert.equal(patched.active, false);
    assert.equal(patched.class_id, fixture.klass);
    assert.equal(patched.subject_id, fixture.math);
    assert.equal(patched.term_id, fixture.term);
    assert.ok(
      new Date(patched.updated_at).getTime() >= new Date(evalBeforePatch.updated_at).getTime(),
      "seul updated_at (et le titre) doivent changer",
    );

    const auditBiEval = await pool.query(
      `SELECT count(*)::int AS count FROM audit_logs WHERE entity_type = 'evaluation' AND entity_id = $1`,
      [String(biEvaluation.rows[0].id)],
    );
    assert.equal(auditBiEval.rows[0].count, 0, "aucun audit sur évaluation BI étrangère");

    await assert.rejects(
      () =>
        store.upsertSchoolAttendanceBatch(
          {
            items: [
              {
                studentId: "BI-2026-0001-STU-01",
                className: "6ème A",
                date: "2026-09-15",
                status: "present",
                teacherId: "ENS-PG-001",
              },
            ],
          },
          admin,
          auditMeta,
        ),
      (error) => error.statusCode === 404,
    );
    const biAttendance = await pool.query(
      `SELECT count(*)::int AS count
       FROM attendance a
       JOIN schools s ON s.id = a.school_id
       WHERE s.school_code = 'BI-2026-0001'`,
    );
    assert.equal(biAttendance.rows[0].count, 0, "aucune présence BI via tenant CD");

    const noYearSchool = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       SELECT country_id, 'NO-YEAR-2026', 'Sans année ouverte', 'active'
       FROM schools WHERE school_code = 'CD-2026-0001'
       RETURNING id`,
    );
    const closedOnlyYear = await pool.query(
      `INSERT INTO academic_years (school_id, name, status)
       VALUES ($1, '2023-2024', 'closed') RETURNING id`,
      [noYearSchool.rows[0].id],
    );
    await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-NO-YEAR', 'Classe fermée', 'active')`,
      [noYearSchool.rows[0].id, closedOnlyYear.rows[0].id],
    );
    await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-NO-YEAR', 'Mathématiques', 1, 'active')`,
      [noYearSchool.rows[0].id],
    );
    await pool.query(
      `INSERT INTO terms (academic_year_id, name, status)
       VALUES ($1, 'Trimestre 1', 'closed')`,
      [closedOnlyYear.rows[0].id],
    );
    const yearsForNoYearBefore = await pool.query(
      `SELECT count(*)::int AS count FROM academic_years WHERE school_id = $1`,
      [noYearSchool.rows[0].id],
    );
    assert.equal(yearsForNoYearBefore.rows[0].count, 1, "fixture : uniquement année fermée");
    await assert.rejects(
      () =>
        store.createEvaluation(
          {
            id: "EVAL-NO-YEAR",
            className: "Classe fermée",
            subject: "Mathématiques",
            period: "Trimestre 1",
            title: "Sans année ouverte",
            teacherId: "ENS-PG-001",
            evaluationType: "Devoir",
          },
          { role: "Admin School", schoolCode: "NO-YEAR-2026", sub: fixture.adminUser },
          auditMeta,
        ),
      (error) => error.statusCode === 400 || error.statusCode === 404,
    );
    const yearsForNoYearAfter = await pool.query(
      `SELECT count(*)::int AS count FROM academic_years WHERE school_id = $1`,
      [noYearSchool.rows[0].id],
    );
    assert.equal(
      yearsForNoYearAfter.rows[0].count,
      yearsForNoYearBefore.rows[0].count,
      "ensure:false ne crée pas d'année scolaire",
    );

    await assert.rejects(
      () =>
        store.upsertSchoolGrade(
          {
            evaluationId: evaluation.id,
            studentId: "BI-2026-0001-STU-01",
            value: 12,
            scale: 20,
          },
          admin,
          auditMeta,
        ),
      (error) =>
        error.code === PEDAGOGY_ERROR.STUDENT_NOT_ENROLLED ||
        error.statusCode === 404 ||
        error.statusCode === 400,
    );

    await assert.rejects(
      () =>
        store.upsertSchoolGrade(
          {
            evaluationId: evaluation.id,
            studentId: "CD-2026-0001-STU-PG-01",
            value: 25,
            scale: 20,
          },
          admin,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.GRADE_INVALID || error.statusCode === 400,
    );

    const grade = await store.upsertSchoolGrade(
      {
        evaluationId: evaluation.id,
        studentId: "CD-2026-0001-STU-PG-01",
        teacherId: "ENS-PG-001",
        value: 14,
        scale: 20,
      },
      admin,
      auditMeta,
    );
    assert.ok(grade.id);
    const lockVersion = Number(grade.version ?? 1);

    const [gradeA, gradeB] = await Promise.all([
      store
        .upsertSchoolGrade(
          {
            evaluationId: evaluation.id,
            studentId: "CD-2026-0001-STU-PG-01",
            teacherId: "ENS-PG-001",
            value: 15,
            scale: 20,
            version: lockVersion,
          },
          admin,
          auditMeta,
        )
        .catch((error) => error),
      store
        .upsertSchoolGrade(
          {
            evaluationId: evaluation.id,
            studentId: "CD-2026-0001-STU-PG-01",
            teacherId: "ENS-PG-001",
            value: 16,
            scale: 20,
            version: lockVersion,
          },
          admin,
          auditMeta,
        )
        .catch((error) => error),
    ]);
    const gradeRows = await pool.query(
      `SELECT count(*)::int AS count FROM grades WHERE evaluation_id = $1 AND student_id = $2`,
      [evaluation.dbId ?? evaluation.id, fixture.student],
    );
    assert.equal(gradeRows.rows[0].count, 1, "une seule note canonique après concurrence");
    const winner = [gradeA, gradeB].find((row) => row?.id && !row.statusCode);
    const conflict = [gradeA, gradeB].find((row) => Number(row?.statusCode) === 409);
    assert.ok(winner, "un upsert concurrent doit réussir");
    assert.ok(conflict, "l'autre upsert concurrent doit 409 (verrou optimiste)");

    const attendance = await store.upsertSchoolAttendanceBatch(
      {
        items: [
          {
            studentId: "CD-2026-0001-STU-PG-01",
            className: "6ème A",
            date: "2026-09-01",
            status: "present",
            teacherId: "ENS-PG-001",
          },
        ],
      },
      admin,
      auditMeta,
    );
    assert.equal(attendance.length, 1);

    await assert.rejects(
      () =>
        store.upsertSchoolAttendanceBatch(
          {
            items: [
              {
                studentId: "CD-2026-0001-STU-PG-01",
                classId: fixture.klass,
                classCode: "CLS-6A",
                date: "2026-09-05",
                status: "present",
                teacherId: "ENS-PG-002",
              },
            ],
          },
          admin,
          auditMeta,
        ),
      (error) =>
        error.statusCode === 409 && error.code === "ATTENDANCE_TEACHER_UNRESOLVED",
    );
    const wrongTeacherRows = await pool.query(
      `SELECT count(*)::int AS count
       FROM attendance a
       JOIN students st ON st.id = a.student_id
       WHERE st.student_code = 'CD-2026-0001-STU-PG-01'
         AND a.attendance_date = DATE '2026-09-05'`,
    );
    assert.equal(
      wrongTeacherRows.rows[0].count,
      0,
      "enseignant classe B pour appel classe A : 409, aucune ligne",
    );

    const fourStatuses = [
      { status: "Présent", present: true, pg: "present" },
      { status: "Absent", present: false, pg: "absent" },
      { status: "Retard", present: true, pg: "late" },
      { status: "Justifié", present: false, pg: "excused" },
    ];
    for (const item of fourStatuses) {
      const [row] = await store.upsertSchoolAttendanceBatch(
        {
          items: [
            {
              studentId: "CD-2026-0001-STU-PG-01",
              className: "6ème A",
              date: "2026-09-03",
              status: item.status,
              teacherId: "ENS-PG-001",
            },
          ],
        },
        admin,
        auditMeta,
      );
      assert.equal(row.status, item.status);
      assert.equal(row.present, item.present);
    }
    const sameDayCount = await pool.query(
      `SELECT count(*)::int AS count, max(a.status) AS status
       FROM attendance a
       JOIN students st ON st.id = a.student_id
       WHERE st.student_code = 'CD-2026-0001-STU-PG-01'
         AND a.attendance_date = DATE '2026-09-03'`,
    );
    assert.equal(sameDayCount.rows[0].count, 1, "upsert jour = une ligne, pas de doublon");
    assert.equal(sameDayCount.rows[0].status, "excused");

    await assert.rejects(
      () =>
        store.upsertSchoolAttendanceBatch(
          {
            items: [
              {
                studentId: "CD-2026-0001-STU-PG-01",
                className: "6ème A",
                date: "2026-09-04",
                status: "Présent",
                teacherId: "ENS-PG-001",
              },
              {
                studentId: "BI-2026-0001-STU-01",
                className: "6ème A",
                date: "2026-09-04",
                status: "Absent",
                teacherId: "ENS-PG-001",
              },
            ],
          },
          admin,
          auditMeta,
        ),
      (error) => error.statusCode === 404 || error.statusCode === 403,
    );
    const rolledBack = await pool.query(
      `SELECT count(*)::int AS count
       FROM attendance a
       JOIN students st ON st.id = a.student_id
       WHERE st.student_code = 'CD-2026-0001-STU-PG-01'
         AND a.attendance_date = DATE '2026-09-04'`,
    );
    assert.equal(rolledBack.rows[0].count, 0, "batch partiel : rollback, 0 succès silencieux");

    const restoreAudit = failAuditWrites(store);
    await assert.rejects(
      () =>
        store.createSchoolCourse(
          { id: `CRS-AUDIT-FAIL-${Date.now()}`, className: "6ème A", name: "Physique" },
          admin,
          auditMeta,
        ),
      (error) => String(error.message).includes("audit write failed"),
    );
    restoreAudit();
    const coursesAfterFailedAudit = await pool.query(
      `SELECT count(*)::int AS count FROM school_courses WHERE subject_id = $1 AND class_id = $2`,
      [fixture.physics, fixture.klass],
    );
    assert.equal(coursesAfterFailedAudit.rows[0].count, 0, "rollback audit : cours non persisté");

    const teacherLive = {
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      sub: fixture.teacherUser,
      identifier: "ENS-PG-001",
      permissions: ["Notes:READ", "Notes:CREATE", "Notes:UPDATE"],
    };
    const teacherCreateOnly = {
      ...teacherLive,
      permissions: ["Notes:READ", "Notes:CREATE"],
    };
    const teacherEval = await store.createEvaluation(
      {
        className: "6ème A",
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: "NOTES-P1 teacher draft",
        evaluationType: "Devoir",
        scale: 20,
      },
      teacherLive,
      auditMeta,
    );
    assert.ok(teacherEval.id);
    assert.equal(teacherEval.status, "Brouillon");
    const teacherEvalRow = await pool.query(
      `SELECT teacher_id, status FROM evaluations WHERE id::text = $1 OR COALESCE(legacy_json_id, '') = $1`,
      [String(teacherEval.id)],
    );
    assert.equal(String(teacherEvalRow.rows[0].teacher_id), String(fixture.teacher));
    assert.equal(teacherEvalRow.rows[0].status, "draft");

    await assert.rejects(
      () =>
        store.updateEvaluation(teacherEval.id, { status: "Validée" }, teacherLive, auditMeta),
      (error) => error.code === PEDAGOGY_ERROR.EVALUATION_VALIDATION_FORBIDDEN,
    );

    const teacherGrade = await store.upsertSchoolGrade(
      {
        evaluationId: teacherEval.id,
        studentId: "CD-2026-0001-STU-PG-01",
        value: 13,
        scale: 20,
      },
      teacherLive,
      auditMeta,
    );
    assert.equal(Number(teacherGrade.score ?? teacherGrade.value), 13);

    const gradesBeforeOtherYear = await pool.query(
      `SELECT count(*)::int AS count, coalesce(max(score), 0)::float AS score FROM grades`,
    );
    await pool.query(
      `UPDATE teacher_assignments
       SET academic_year_id = $1
       WHERE teacher_id = $2 AND class_id = $3 AND subject_id = $4 AND academic_year_id = $5`,
      [fixture.closedYear, fixture.teacher, fixture.klass, fixture.math, fixture.openYear],
    );
    await assert.rejects(
      () =>
        store.upsertSchoolGrade(
          {
            evaluationId: teacherEval.id,
            studentId: "CD-2026-0001-STU-PG-01",
            value: 11,
            scale: 20,
          },
          teacherLive,
          auditMeta,
        ),
      (error) => error.statusCode === 403,
      "même teacher/class/subject, assignment autre année → 403",
    );
    const gradesAfterOtherYear = await pool.query(
      `SELECT count(*)::int AS count, coalesce(max(score), 0)::float AS score FROM grades`,
    );
    assert.equal(
      gradesAfterOtherYear.rows[0].count,
      gradesBeforeOtherYear.rows[0].count,
      "COUNT grades inchangé si assignment d'une autre année",
    );
    assert.equal(Number(gradesAfterOtherYear.rows[0].score), Number(gradesBeforeOtherYear.rows[0].score));
    await pool.query(
      `UPDATE teacher_assignments
       SET academic_year_id = $1
       WHERE teacher_id = $2 AND class_id = $3 AND subject_id = $4 AND academic_year_id = $5`,
      [fixture.openYear, fixture.teacher, fixture.klass, fixture.math, fixture.closedYear],
    );

    await assert.rejects(
      () =>
        store.upsertSchoolGrade(
          {
            evaluationId: teacherEval.id,
            studentId: "CD-2026-0001-STU-PG-01",
            value: 11,
            scale: 20,
          },
          {
            role: "Enseignant",
            schoolCode: "CD-2026-0001",
            identifier: "ENS-PG-001",
            permissions: ["Notes:READ", "Notes:CREATE", "Notes:UPDATE"],
          },
          auditMeta,
        ),
      (error) => error.statusCode === 403,
      "principal sans sub (identifier BO) → 403",
    );

    await assert.rejects(
      () =>
        store.upsertSchoolGrade(
          {
            evaluationId: teacherEval.id,
            studentId: "CD-2026-0001-STU-PG-01",
            value: 15,
            scale: 20,
          },
          teacherCreateOnly,
          auditMeta,
        ),
      (error) => error.statusCode === 403,
      "CREATE seul ne modifie pas une note existante",
    );

    await assert.rejects(
      () =>
        store.createEvaluation(
          {
            className: "6ème A",
            subject: "Physique",
            period: "Trimestre 1",
            title: "NOTES-P1 other subject",
            evaluationType: "Devoir",
            scale: 20,
          },
          teacherLive,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED || error.statusCode === 403,
    );

    await assert.rejects(
      () =>
        store.createEvaluation(
          {
            className: "6ème B-ATT",
            subject: "Mathématiques",
            period: "Trimestre 1",
            title: "NOTES-P1 other class",
            evaluationType: "Devoir",
            scale: 20,
          },
          teacherLive,
          auditMeta,
        ),
      (error) => error.code === PEDAGOGY_ERROR.TEACHER_ASSIGNMENT_REQUIRED || error.statusCode === 403,
    );

    await pool.query(
      `UPDATE teacher_assignments
       SET status = 'deleted'
       WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3`,
      [fixture.teacher, fixture.klass, fixture.math],
    );
    await assert.rejects(
      () =>
        store.upsertSchoolGrade(
          {
            evaluationId: teacherEval.id,
            studentId: "CD-2026-0001-STU-PG-01",
            value: 11,
            scale: 20,
          },
          teacherLive,
          auditMeta,
        ),
      (error) => error.statusCode === 403,
      "affectation révoquée → fail closed",
    );
    await pool.query(
      `UPDATE teacher_assignments
       SET status = 'active'
       WHERE teacher_id = $1 AND class_id = $2 AND subject_id = $3`,
      [fixture.teacher, fixture.klass, fixture.math],
    );

    const teacherUpdated = await store.upsertSchoolGrade(
      {
        evaluationId: teacherEval.id,
        studentId: "CD-2026-0001-STU-PG-01",
        value: 15,
        scale: 20,
      },
      teacherLive,
      auditMeta,
    );
    assert.equal(Number(teacherUpdated.score ?? teacherUpdated.value), 15, "NOTES-P1 : UPDATE note après affectation restaurée");

    const projection = await store.listProjection();
    const schoolCourses = projection.courses.filter((row) => row.schoolCode === "CD-2026-0001");
    const schoolSlots = projection.courseSchedules.filter((row) => row.schoolCode === "CD-2026-0001");
    assert.ok(schoolCourses.some((row) => row.name === "Mathématiques"));
    assert.ok(schoolSlots.some((row) => row.schoolCourseId === course.schoolCourseId && row.dayOfWeek === 1));
    assert.ok(projection.notes.some((row) => Number(row.value ?? row.score) === 14 || Number(row.value) >= 14));
    const projectedNote = projection.notes.find((row) => Number(row.value ?? row.score) >= 14);
    assert.equal(projectedNote.teacherId, "ENS-PG-001");
    assert.notEqual(projectedNote.authorId, "ENS-PG-001");

    const boState = await pool.query(`SELECT state_payload FROM backoffice_state WHERE state_key = 'default'`);
    assert.equal(boState.rowCount, 0, "aucune projection JSON historique backoffice_state");

    const auditRows = await pool.query(
      `SELECT * FROM audit_logs WHERE action IN ('create_course', 'create_course_schedule', 'upsert_grade', 'upsert_attendance_batch')`,
    );
    assert.ok(auditRows.rowCount >= 4);

    console.log("pedagogyRepository.pg.test.js: OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
