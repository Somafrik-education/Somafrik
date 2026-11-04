"use strict";

/**
 * PERF-PR1 — isolation PostgreSQL réelle des projections pédagogie et finance.
 * Deux établissements, lectures croisées, parité avec la lecture plateforme filtrée,
 * établissement vide, identifiant invalide, erreur SQL sans repli global.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { createPedagogyPgStore } = require("../db/pedagogyPgStore");
const { createFinancePgStore } = require("../db/financePgStore");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const DATABASE_NAME = String(process.env.SOMAFRIK_PERF_PR1_DATABASE ?? "somafrik_perf_pr1")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function idsOf(rows, field = "schoolId") {
  return new Set(rows.map((row) => String(row[field] ?? "").toLowerCase()).filter(Boolean));
}

function bySchool(rows, schoolId) {
  const wanted = String(schoolId).toLowerCase();
  return rows
    .filter((row) => String(row.schoolId ?? "").toLowerCase() === wanted)
    .sort((left, right) => String(left.id ?? left.dbId).localeCompare(String(right.id ?? right.dbId)));
}

async function seedSchool(pool, { iso, schoolCode, loginCode, name, mark }) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ($1, $2, '+000', 'CDF')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [`Pays ${iso}`, iso],
  );
  const countryId = country.rows[0]?.id
    ?? (await pool.query("SELECT id FROM countries WHERE iso_code = $1", [iso])).rows[0].id;
  const school = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, name, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [countryId, schoolCode, loginCode, name],
  );
  const schoolId = school.rows[0].id;
  const year = await pool.query(
    `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
    [schoolId],
  );
  const term = await pool.query(
    `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open') RETURNING id`,
    [year.rows[0].id],
  );
  const klass = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [schoolId, year.rows[0].id, `${mark}-C1`, `Classe ${mark}`],
  );
  const subject = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, coefficient)
     VALUES ($1, $2, 'Mathématiques', 1) RETURNING id`,
    [schoolId, `${mark}-MATH`],
  );
  const user = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role)
     VALUES ($1, $2, $3, 'Prof', 'Enseignant') RETURNING id`,
    [schoolId, `${mark}-U1`, name],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code) VALUES ($1, $2, $3) RETURNING id`,
    [schoolId, user.rows[0].id, `${mark}-T1`],
  );
  const student = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name)
     VALUES ($1, $2, 'Eleve', $3) RETURNING id`,
    [schoolId, `${mark}-STU`, name],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'enrolled')`,
    [schoolId, student.rows[0].id, klass.rows[0].id, year.rows[0].id],
  );
  const course = await pool.query(
    `INSERT INTO school_courses (school_id, class_id, subject_id, teacher_id, course_code, coefficient, status)
     VALUES ($1, $2, $3, $4, $5, 3, 'active') RETURNING id`,
    [schoolId, klass.rows[0].id, subject.rows[0].id, teacher.rows[0].id, `${mark}-COURSE`],
  );
  const evaluation = await pool.query(
    `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, coefficient, status)
     VALUES ($1, $2, $3, $4, $5, $6, 2, 'published') RETURNING id`,
    [schoolId, klass.rows[0].id, subject.rows[0].id, teacher.rows[0].id, term.rows[0].id, `Eval ${mark}`],
  );
  await pool.query(
    `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id,
                         grade_type, score, max_score, coefficient, grade_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'devoir', $8, 20, 1, 'graded')`,
    [schoolId, student.rows[0].id, klass.rows[0].id, subject.rows[0].id, teacher.rows[0].id, term.rows[0].id, evaluation.rows[0].id, mark === "A" ? 14 : 9],
  );
  await pool.query(
    `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [schoolId, student.rows[0].id, klass.rows[0].id, teacher.rows[0].id, mark === "A" ? "2026-10-01" : "2026-10-02", mark === "A" ? "present" : "absent"],
  );
  await pool.query(
    `INSERT INTO course_schedule_weekly_slots
       (school_id, academic_year_id, school_course_id, class_id, teacher_id, day_of_week, start_time, end_time, status)
     VALUES ($1, $2, $3, $4, $5, 1, '08:00', '09:00', 'active')`,
    [schoolId, year.rows[0].id, course.rows[0].id, klass.rows[0].id, teacher.rows[0].id],
  );
  const obligation = await pool.query(
    `INSERT INTO student_fee_obligations
       (school_id, student_id, class_id, fee_type, label, currency, amount_due, amount_paid, balance, status)
     VALUES ($1, $2, $3, 'scolarite', $4, 'CDF', 100, 40, 60, 'Partiel') RETURNING id`,
    [schoolId, student.rows[0].id, klass.rows[0].id, `Frais ${mark}`],
  );
  const payment = await pool.query(
    `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date)
     VALUES ($1, $2, $3, 40, 'CDF', 'cash', 'paid', '2026-10-03') RETURNING id`,
    [schoolId, student.rows[0].id, `${mark}-PAY-1`],
  );
  await pool.query(
    `INSERT INTO payment_items (school_id, payment_id, fee_type, fee_label, amount)
     VALUES ($1, $2, 'scolarite', $3, 40)`,
    [schoolId, payment.rows[0].id, `Ligne ${mark}`],
  );
  await pool.query(
    `INSERT INTO payment_allocations (school_id, payment_id, obligation_id, amount)
     VALUES ($1, $2, $3, 40)`,
    [schoolId, payment.rows[0].id, obligation.rows[0].id],
  );
  await pool.query(
    `INSERT INTO payment_reminders (school_id, student_id, student_fee_obligation_id, message)
     VALUES ($1, $2, $3, $4)`,
    [schoolId, student.rows[0].id, obligation.rows[0].id, `Rappel ${mark}`],
  );
  const grid = await pool.query(
    `INSERT INTO fee_grids (school_id, grid_code, name, class_name, academic_year, currency)
     VALUES ($1, $2, $3, $4, '2025-2026', 'CDF') RETURNING id`,
    [schoolId, `${mark}-GRID`, `Grille ${mark}`, `Classe ${mark}`],
  );
  await pool.query(
    `INSERT INTO school_fee_items (school_id, fee_grid_id, item_code, fee_type, label, amount)
     VALUES ($1, $2, $3, 'scolarite', $4, 100)`,
    [schoolId, grid.rows[0].id, `${mark}-ITEM`, `Poste ${mark}`],
  );
  await pool.query(
    `INSERT INTO fee_tariff_history (school_id, fee_grid_id, action) VALUES ($1, $2, 'create')`,
    [schoolId, grid.rows[0].id],
  );
  await pool.query(
    `INSERT INTO payment_statuses (school_id, status_code, label) VALUES ($1, $2, $3)`,
    [schoolId, `${mark}-PAID`, `Payé ${mark}`],
  );
  return { schoolId, studentId: student.rows[0].id, obligationId: obligation.rows[0].id, paymentId: payment.rows[0].id };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("perfPr1SchoolScope.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, DATABASE_NAME);
  const pool = new Pool({ connectionString: isolatedUrl });
  const repo = createPostgresRepository(isolatedUrl);
  repo.ready = true;
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    await pool.query(FINANCE_SCHEMA_SQL);
    await pool.query(PEDAGOGY_SCHEMA_SQL);

    const schoolA = await seedSchool(pool, {
      iso: "CD",
      schoolCode: "CD-2026-0001",
      loginCode: "CD-LAC-26-001",
      name: "Lycee A",
      mark: "A",
    });
    const schoolB = await seedSchool(pool, {
      iso: "BI",
      schoolCode: "BI-2026-0001",
      loginCode: "BI-BUJ-26-001",
      name: "Lycee B",
      mark: "B",
    });
    const empty = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       SELECT country_id, 'CD-2026-0009', 'CD-VIDE-26-009', 'Lycee vide', 'active'
       FROM schools WHERE id = $1 RETURNING id`,
      [schoolA.schoolId],
    );
    await pool.query(
      `INSERT INTO payment_statuses (school_id, status_code, label) VALUES (NULL, 'GLOBAL', 'Statut global')`,
    );

    const pedagogy = createPedagogyPgStore(repo);
    const finance = createFinancePgStore(repo);
    const captured = [];
    const originalAll = repo.all.bind(repo);
    repo.all = async (sql, params = []) => {
      captured.push({ sql: String(sql), params: [...params] });
      return originalAll(sql, params);
    };

    const pedagogyA = await pedagogy.listProjection({ schoolId: schoolA.schoolId });
    const financeA = await finance.listProjection({ schoolId: schoolA.schoolId });
    const schoolSql = captured.splice(0, captured.length);
    assert.equal(schoolSql.length, 14);
    for (const call of schoolSql) {
      assert.match(call.sql, /\$1::uuid/);
      assert.deepEqual(call.params, [schoolA.schoolId]);
      assert.equal(call.sql.includes(schoolB.schoolId), false);
    }
    const obligations = schoolSql.find((call) => call.sql.includes("student_fee_obligations"));
    assert.match(obligations.sql, /e\.school_id = o\.school_id/);
    const gradesSql = schoolSql.find((call) => call.sql.includes("FROM grades"));
    const inner = gradesSql.sql.slice(gradesSql.sql.indexOf("SELECT sc.coefficient"), gradesSql.sql.indexOf("LIMIT 1"));
    assert.equal(inner.includes("$1"), false);

    const pedagogyB = await pedagogy.listProjection({ schoolId: schoolB.schoolId });
    const financeB = await finance.listProjection({ schoolId: schoolB.schoolId });
    captured.length = 0;
    const pedagogyAll = await pedagogy.listProjection({ platform: true });
    const financeAll = await finance.listProjection({ platform: true });

    for (const bundle of [pedagogyA, financeA]) {
      for (const rows of Object.values(bundle)) {
        if (!Array.isArray(rows)) continue;
        assert.equal(idsOf(rows).has(schoolB.schoolId.toLowerCase()), false);
      }
    }
    for (const bundle of [pedagogyB, financeB]) {
      for (const rows of Object.values(bundle)) {
        if (!Array.isArray(rows)) continue;
        assert.equal(idsOf(rows).has(schoolA.schoolId.toLowerCase()), false);
      }
    }
    assert.equal(idsOf(pedagogyAll.notes).size, 2);
    assert.equal(idsOf(financeAll.payments).size, 2);

    assert.deepEqual(bySchool(pedagogyA.notes, schoolA.schoolId), bySchool(pedagogyAll.notes, schoolA.schoolId));
    assert.deepEqual(bySchool(pedagogyA.presences, schoolA.schoolId), bySchool(pedagogyAll.presences, schoolA.schoolId));
    assert.deepEqual(bySchool(pedagogyA.evaluations, schoolA.schoolId), bySchool(pedagogyAll.evaluations, schoolA.schoolId));
    assert.deepEqual(bySchool(pedagogyA.courses, schoolA.schoolId), bySchool(pedagogyAll.courses, schoolA.schoolId));
    assert.deepEqual(bySchool(pedagogyA.courseSchedules, schoolA.schoolId), bySchool(pedagogyAll.courseSchedules, schoolA.schoolId));
    assert.deepEqual(bySchool(financeA.payments, schoolA.schoolId), bySchool(financeAll.payments, schoolA.schoolId));
    assert.deepEqual(bySchool(financeA.studentFees, schoolA.schoolId), bySchool(financeAll.studentFees, schoolA.schoolId));
    assert.deepEqual(bySchool(financeA.feeGrids, schoolA.schoolId), bySchool(financeAll.feeGrids, schoolA.schoolId));
    assert.deepEqual(bySchool(financeA.paymentReminders, schoolA.schoolId), bySchool(financeAll.paymentReminders, schoolA.schoolId));

    const noteA = pedagogyA.notes[0];
    assert.equal(noteA.value, 14);
    assert.equal(noteA.coefficient, 3);
    assert.equal(noteA.evaluationCoefficient, 2);
    assert.equal(noteA.period, "Trimestre 1");
    assert.equal(pedagogyA.presences[0].status, "Présent");
    assert.equal(pedagogyB.presences[0].status, "Absent");
    assert.equal(financeA.payments[0].allocatedAmount, 40);
    assert.equal(financeA.payments[0].amount, 40);
    assert.equal(financeA.studentFees[0].balance, 60);
    assert.equal(financeA.studentFees[0].hasActiveEnrollment, true);
    assert.equal(financeA.payments[0].items?.length ?? financeA.payments[0].paymentItems?.length ?? 1, 1);

    const globalStatus = financeAll.paymentStatuses.find((row) => row.code === "GLOBAL" || row.statusCode === "GLOBAL" || row.label === "Statut global");
    assert.ok(globalStatus, "le statut global reste dans la lecture plateforme explicite");
    assert.equal(
      financeA.paymentStatuses.some((row) => row.label === "Statut global" || row.code === "GLOBAL"),
      false,
    );
    assert.ok(financeA.paymentStatuses.some((row) => String(row.schoolId).toLowerCase() === schoolA.schoolId.toLowerCase()));

    const emptyPedagogy = await pedagogy.listProjection({ schoolId: empty.rows[0].id });
    const emptyFinance = await finance.listProjection({ schoolId: empty.rows[0].id });
    assert.equal(emptyPedagogy.notes.length, 0);
    assert.equal(emptyPedagogy.presences.length, 0);
    assert.equal(emptyFinance.payments.length, 0);
    assert.equal(emptyFinance.studentFees.length, 0);

    const unknown = "33333333-3333-4333-8333-333333333333";
    const unknownPedagogy = await pedagogy.listProjection({ schoolId: unknown });
    assert.equal(unknownPedagogy.notes.length, 0);
    assert.equal(unknownPedagogy.presences.length, 0);

    await assert.rejects(
      () => pedagogy.listProjection(),
      (error) => error.code === "PROJECTION_SCHOOL_REQUIRED",
    );
    await assert.rejects(
      () => finance.listProjection({ schoolId: "BI-2026-0001" }),
      (error) => error.code === "PROJECTION_SCHOOL_INVALID",
    );

    await pool.query("DROP TABLE attendance");
    await assert.rejects(() => pedagogy.listProjection({ schoolId: schoolA.schoolId }), (error) => error.code === "42P01");
    await assert.rejects(
      () => pedagogy.listProjection({ platform: true }),
      (error) => error.code === "42P01",
    );

    console.log("perfPr1SchoolScope.pg.test.js: OK");
  } finally {
    await pool.end();
    if (typeof repo.pool?.end === "function") await repo.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
