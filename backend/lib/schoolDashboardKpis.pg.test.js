"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { listSchoolDashboardKpis } = require("./schoolDashboardKpis");
const {
  assertOwnedDisposable,
  createOwnedDisposableDatabase,
  dropOwnedDisposableDatabase,
} = require("./perfPr1DisposableDatabase");

const DATABASE_URL = process.env.DATABASE_URL || "";
const NOW = new Date("2026-11-04T10:00:00.000Z");
const ADMIN_RIGHTS = [
  "Élèves:READ",
  "Enseignants:READ",
  "Classes:READ",
  "Paiements:READ",
  "Présences:READ",
  "Notes:READ",
  "Examens:READ",
  "Bulletins:READ",
  "Documents:READ",
  "Utilisateurs:READ",
  "Annonces:READ",
];

function repositoryFor(pool) {
  return {
    all: async (sql, params = []) => {
      try {
        return (await pool.query(sql, params)).rows;
      } catch (error) {
        error.message = `${error.message}\nSQL ${String(sql).slice(0, 240)}`;
        throw error;
      }
    },
  };
}

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const yearName = "2025-2026";
  async function school(code, name) {
    const created = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [country.rows[0].id, code, `${code}-LOGIN`, name],
    );
    const schoolId = created.rows[0].id;
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1, $2, true, 'open') RETURNING id`,
      [schoolId, yearName],
    );
    const term = await pool.query(
      `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'T1', 'open') RETURNING id`,
      [year.rows[0].id],
    );
    return { schoolId, yearId: year.rows[0].id, termId: term.rows[0].id };
  }
  const schoolA = await school("CD-2026-0001", "Lycee A");
  const schoolB = await school("CD-2026-0002", "Lycee B");
  const empty = await school("CD-2026-0009", "Lycee vide");
  await pool.query(
    `UPDATE schools SET profile_payload = profile_payload || '{"timezone":"Africa/Kinshasa"}'::jsonb WHERE id = $1`,
    [schoolA.schoolId],
  );
  await pool.query(
    `UPDATE schools SET profile_payload = profile_payload || '{"timezone":"Pacific/Auckland"}'::jsonb WHERE id = $1`,
    [schoolB.schoolId],
  );
  await pool.query(
    `UPDATE schools SET profile_payload = profile_payload || '{"timezone":"America/New_York"}'::jsonb WHERE id = $1`,
    [empty.schoolId],
  );

  async function addClass(target, code, name, level) {
    const created = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, level)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [target.schoolId, target.yearId, code, name, level],
    );
    return created.rows[0].id;
  }
  const class6 = await addClass(schoolA, "A-6E", "6e A", "6e");
  const class5 = await addClass(schoolA, "A-5E", "5e A", "5e");
  const classB = await addClass(schoolB, "B-6E", "6e B", "6e");

  const subject = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name) VALUES ($1, 'A-MATH', 'Mathématiques') RETURNING id`,
    [schoolA.schoolId],
  );
  const teacherUser = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role, status, created_at)
     VALUES ($1, 'A-PROF', 'Awa', 'Kabila', 'Enseignant', 'active', '2026-11-02T08:00:00Z') RETURNING id`,
    [schoolA.schoolId],
  );
  await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role, status, created_at)
     VALUES ($1, 'A-OLD', 'Ancien', 'Compte', 'Secrétaire', 'active', '2026-01-15T08:00:00Z')`,
    [schoolA.schoolId],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code) VALUES ($1, $2, 'A-T1') RETURNING id`,
    [schoolA.schoolId, teacherUser.rows[0].id],
  );
  await pool.query(
    `INSERT INTO teacher_assignments
       (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolA.schoolId, teacher.rows[0].id, class6, subject.rows[0].id, schoolA.yearId],
  );

  async function addStudent(target, code, status, classId) {
    const created = await pool.query(
      `INSERT INTO students (school_id, student_code, first_name, last_name, status)
       VALUES ($1, $2, 'Eleve', $3, $4) RETURNING id`,
      [target.schoolId, code, code, status],
    );
    if (classId) {
      await pool.query(
        `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
         VALUES ($1, $2, $3, $4, 'enrolled')`,
        [target.schoolId, created.rows[0].id, classId, target.yearId],
      );
    }
    return created.rows[0].id;
  }
  const s1 = await addStudent(schoolA, "A-S1", "active", class6);
  const s2 = await addStudent(schoolA, "A-S2", "active", class5);
  await addStudent(schoolA, "A-S3", "inactive", class6);
  await addStudent(schoolA, "A-S4", "active", null);
  const foreign = await addStudent(schoolB, "B-S1", "active", classB);

  async function attend(schoolId, studentId, classId, date, status) {
    await pool.query(
      `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [schoolId, studentId, classId, teacher.rows[0].id, date, status],
    );
  }
  await attend(schoolA.schoolId, s1, class6, "2026-11-04", "present");
  await attend(schoolA.schoolId, s2, class5, "2026-11-04", "late");
  await attend(schoolA.schoolId, s1, class6, "2026-11-02", "absent");
  await attend(schoolA.schoolId, s2, class5, "2026-11-03", "excused");
  await attend(schoolA.schoolId, s1, class6, "2026-01-15", "absent");
  await attend(schoolB.schoolId, foreign, classB, "2026-11-04", "present");

  async function pay(schoolId, studentId, code, amount, status, date) {
    await pool.query(
      `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date)
       VALUES ($1, $2, $3, $4, 'CDF', 'cash', $5, $6)`,
      [schoolId, studentId, code, amount, status, date],
    );
  }
  await pay(schoolA.schoolId, s1, "A-PAY-1", 40, "paid", "2026-11-03");
  await pay(schoolA.schoolId, s1, "A-PAY-2", 50, "paid", "2026-11-02");
  await pay(schoolA.schoolId, s1, "A-PAY-CANCEL", 999, "cancelled", "2026-11-02");
  await pay(schoolA.schoolId, s1, "A-PAY-OLD", 7, "paid", "2026-01-15");
  await pay(schoolB.schoolId, foreign, "B-PAY-1", 500, "paid", "2026-11-03");

  async function obligation(studentId, due, paid, status) {
    await pool.query(
      `INSERT INTO student_fee_obligations
         (school_id, student_id, class_id, fee_type, label, currency, amount_due, amount_paid, exemption, balance, status)
       VALUES ($1, $2, $3, 'scolarite', $4, 'CDF', $5, $6, 0, $7, $8)`,
      [schoolA.schoolId, studentId, class6, status, due, paid, Math.max(0, due - paid), status],
    );
  }
  await obligation(s1, 100, 40, "Partiel");
  await obligation(s1, 50, 50, "Payé");
  await obligation(s2, 20, 0, "À payer");
  await pool.query(
    `INSERT INTO student_fee_obligations
       (school_id, student_id, class_id, fee_type, label, currency, amount_due, amount_paid, balance, status)
     VALUES ($1, $2, $3, 'scolarite', 'Annule', 'CDF', 80, 0, 80, 'cancelled')`,
    [schoolA.schoolId, s1, class6],
  );
  await pool.query(
    `INSERT INTO payment_allocations (school_id, payment_id, obligation_id, amount)
     SELECT p.school_id, p.id, o.id, 40
     FROM payments p
     JOIN student_fee_obligations o ON o.school_id = p.school_id AND o.label = 'Partiel'
     WHERE p.payment_code = 'A-PAY-1'`,
  );

  const evaluation = await pool.query(
    `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, coefficient, status)
     VALUES ($1, $2, $3, $4, $5, 'Devoir', 1, 'published') RETURNING id`,
    [schoolA.schoolId, class6, subject.rows[0].id, teacher.rows[0].id, schoolA.termId],
  );
  await pool.query(
    `INSERT INTO grades
       (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, grade_status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'devoir', 14, 'graded', '2026-11-02T09:00:00Z')`,
    [schoolA.schoolId, s1, class6, subject.rows[0].id, teacher.rows[0].id, schoolA.termId, evaluation.rows[0].id],
  );
  await pool.query(
    `INSERT INTO grades
       (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id, grade_type, score, grade_status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'devoir', 12, 'graded', '2026-01-15T09:00:00Z')`,
    [schoolA.schoolId, s2, class5, subject.rows[0].id, teacher.rows[0].id, schoolA.termId, evaluation.rows[0].id],
  );
  await pool.query(
    `INSERT INTO exams (school_id, class_id, subject_id, exam_code, name, exam_type, exam_date, status)
     VALUES ($1, $2, $3, 'A-EX-1', 'Examen novembre', 'composition', '2026-11-03', 'scheduled'),
            ($1, $4, $3, 'A-EX-OLD', 'Examen janvier', 'composition', '2026-01-10', 'scheduled')`,
    [schoolA.schoolId, class6, subject.rows[0].id, class5],
  );
  await pool.query(
    `INSERT INTO report_cards (school_id, student_id, class_id, academic_year_id, term_id, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'draft', '2026-11-02T09:00:00Z')`,
    [schoolA.schoolId, s1, class6, schoolA.yearId, schoolA.termId],
  );
  await pool.query(
    `INSERT INTO student_documents (school_id, student_id, document_code, document_type, title, generated_at)
     VALUES ($1, $2, 'A-DOC-1', 'attestation', 'Attestation', '2026-11-02T09:00:00Z')`,
    [schoolA.schoolId, s1],
  );
  await pool.query(
    `INSERT INTO announcements (school_id, title, message, created_at)
     VALUES ($1, 'Rentree', 'Message', '2026-11-01T09:00:00Z')`,
    [schoolA.schoolId],
  );

  const stamp = "2026-11-04T10:00:00.000Z";
  for (const table of ["students", "teachers", "classes", "attendance", "payments", "student_fee_obligations"]) {
    await pool.query(`UPDATE ${table} SET created_at = $1, updated_at = $1`, [stamp]);
  }

  const volumes = await pool.query(
    `SELECT
       (SELECT COALESCE(SUM(octet_length(row_to_json(s)::text)), 0) FROM students s WHERE school_id = $1) AS students,
       (SELECT COALESCE(SUM(octet_length(row_to_json(t)::text)), 0) FROM teachers t WHERE school_id = $1) AS teachers,
       (SELECT COALESCE(SUM(octet_length(row_to_json(c)::text)), 0) FROM classes c WHERE school_id = $1) AS classes,
       (SELECT COALESCE(SUM(octet_length(row_to_json(a)::text)), 0) FROM attendance a WHERE school_id = $1) AS presences,
       (SELECT COALESCE(SUM(octet_length(row_to_json(p)::text)), 0) FROM payments p WHERE school_id = $1) AS payments,
       (SELECT COALESCE(SUM(octet_length(row_to_json(o)::text)), 0) FROM student_fee_obligations o WHERE school_id = $1) AS fees`,
    [schoolA.schoolId],
  );

  return {
    schoolA: schoolA.schoolId,
    schoolB: schoolB.schoolId,
    empty: empty.schoolId,
    teacherUserId: teacherUser.rows[0].id,
    volumes: volumes.rows[0],
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("schoolDashboardKpis.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  const owned = await createOwnedDisposableDatabase(DATABASE_URL);
  const pool = owned.pool;
  try {
    await assertOwnedDisposable(pool, owned.databaseName, owned.token);
    await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
    const fixture = await seed(pool);
    const repository = repositoryFor(pool);
    const admin = {
      role: "Admin School",
      schoolId: fixture.schoolA,
      permissions: ADMIN_RIGHTS,
    };
    const monthly = await listSchoolDashboardKpis(repository, admin, { period: "monthly", schoolId: fixture.schoolB }, NOW);
    assert.equal(monthly.schoolId, fixture.schoolA);
    assert.equal(monthly.timeZone, "Africa/Kinshasa");
    assert.equal(monthly.cards.students, 4);
    assert.equal(monthly.cards.teachers, 1);
    assert.equal(monthly.cards.classes, 2);
    assert.equal(monthly.cards.revenue.display, "97 CDF");
    assert.equal(monthly.cards.revenue.amount, 97);
    assert.deepEqual(
      monthly.cards.levels.map((item) => `${item.name}:${item.value}`),
      ["6e:2", "5e:1", "Non renseigné:1"],
    );
    assert.equal(monthly.cards.attendance.value, "100 %");
    assert.equal(monthly.cards.attendance.expected, 2);
    assert.equal(monthly.cards.attendance.recorded, 2);
    assert.equal(monthly.cards.paymentRate.value, "53 %");
    assert.equal(monthly.cards.paymentRate.expectedAmount, 170);
    assert.equal(monthly.cards.paymentRate.collectedAmount, 90);
    assert.equal(monthly.series.presence.present, 1);
    assert.equal(monthly.series.presence.late, 1);
    assert.equal(monthly.series.presence.absent, 1);
    assert.equal(monthly.series.presence.justified, 1);
    assert.equal(monthly.series.presence.total, 4);
    assert.equal(monthly.series.presence.rate, 50);
    assert.equal(monthly.series.notes, 1);
    assert.equal(monthly.series.exams, 1);
    assert.equal(monthly.series.bulletins, 1);
    assert.equal(monthly.series.pendingBulletins, 1);
    assert.equal(monthly.series.documents, 1);
    assert.equal(monthly.series.activeUsers, 1);
    assert.equal(monthly.series.announcements, 1);
    const paid = monthly.series.paymentAmounts.find((item) => item.name === "Payé");
    const other = monthly.series.paymentAmounts.find((item) => item.name === "Autre");
    assert.equal(paid.value, 90);
    assert.equal(other.value, 999);
    assert.equal(monthly.series.notesBySubject[0].name, "Mathématiques");

    const annual = await listSchoolDashboardKpis(repository, admin, { period: "annual" }, NOW);
    assert.equal(annual.series.presence.total, 5);
    assert.equal(annual.series.presence.absent, 2);
    assert.equal(annual.series.notes, 2);
    assert.equal(annual.cards.revenue.amount, 97);

    const teacher = await listSchoolDashboardKpis(
      repository,
      {
        role: "Enseignant",
        id: fixture.teacherUserId,
        schoolId: fixture.schoolA,
        permissions: ["Élèves:READ", "Présences:READ", "Classes:READ"],
      },
      { period: "monthly" },
      NOW,
    );
    assert.equal(teacher.cards.students, 2);
    assert.equal(teacher.cards.classes, 1);
    assert.equal(teacher.cards.revenue, null);
    assert.equal(teacher.cards.attendance.expected, 1);
    assert.equal(teacher.cards.attendance.value, "100 %");
    assert.equal(teacher.series.presence.total, 2);
    assert.equal(teacher.series.paymentStatus, null);

    const libreUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
       VALUES ($1, 'A-LIBRE', 'Sans', 'Classe', 'Enseignant', 'active') RETURNING id`,
      [fixture.schoolA],
    );
    const libreTeacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code) VALUES ($1, $2, 'A-T0') RETURNING id`,
      [fixture.schoolA, libreUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments
         (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       SELECT $1, $2, c.id, s.id, y.id, 'inactive'
       FROM classes c
       JOIN subjects s ON s.school_id = c.school_id
       JOIN academic_years y ON y.school_id = c.school_id AND y.is_current = true
       WHERE c.school_id = $1 AND c.class_code = 'A-6E'
       LIMIT 1`,
      [fixture.schoolA, libreTeacher.rows[0].id],
    );
    await pool.query(
      `INSERT INTO class_head_teachers
         (school_id, class_id, teacher_id, academic_year_id, status, ended_at)
       SELECT $1, c.id, $2, y.id, 'inactive', NOW()
       FROM classes c
       JOIN academic_years y ON y.school_id = c.school_id AND y.is_current = true
       WHERE c.school_id = $1 AND c.class_code = 'A-6E'
       LIMIT 1`,
      [fixture.schoolA, libreTeacher.rows[0].id],
    );
    const unassigned = await listSchoolDashboardKpis(
      repository,
      {
        role: "Enseignant",
        id: libreUser.rows[0].id,
        schoolId: fixture.schoolA,
        permissions: ADMIN_RIGHTS,
      },
      { period: "monthly" },
      NOW,
    );
    const stillThere = await listSchoolDashboardKpis(repository, admin, { period: "monthly" }, NOW);
    assert.equal(stillThere.cards.students, 4);
    assert.equal(stillThere.cards.teachers, 2);
    assert.equal(stillThere.cards.classes, 2);
    assert.equal(stillThere.cards.revenue.amount, 97);
    assert.equal(stillThere.cards.paymentRate.value, "53 %");
    assert.equal(stillThere.series.presence.total, 4);
    assert.equal(stillThere.series.announcements, 1);
    assert.equal(unassigned.schoolId, fixture.schoolA);
    assert.equal(unassigned.cards.students, 0);
    assert.equal(unassigned.cards.teachers, 0);
    assert.equal(unassigned.cards.classes, 0);
    assert.equal(unassigned.cards.revenue.display, "—");
    assert.equal(unassigned.cards.revenue.amount, null);
    assert.equal(unassigned.cards.paymentRate.value, "—");
    assert.equal(unassigned.cards.attendance.value, "—");
    assert.equal(unassigned.cards.attendance.expected, 0);
    assert.deepEqual(unassigned.cards.levels, []);
    assert.equal(unassigned.series.presence.total, 0);
    assert.equal(unassigned.series.notes, 0);
    assert.equal(unassigned.series.exams, 0);
    assert.equal(unassigned.series.bulletins, 0);
    assert.equal(unassigned.series.documents, 0);
    assert.equal(unassigned.series.activeUsers, 0);
    assert.equal(unassigned.series.announcements, 0);
    assert.deepEqual(unassigned.series.paymentStatus, []);
    assert.deepEqual(unassigned.series.paymentAmounts, []);
    assert.deepEqual(unassigned.series.classSizes, []);
    assert.deepEqual(unassigned.series.notesBySubject, []);

    const crossing = new Date("2026-11-04T23:30:00.000Z");
    const kinshasaNight = await listSchoolDashboardKpis(repository, admin, { period: "daily" }, crossing);
    const newYorkNight = await listSchoolDashboardKpis(
      repository,
      { role: "Admin School", schoolId: fixture.empty, permissions: ["Annonces:READ"] },
      { period: "daily" },
      crossing,
    );
    const aucklandNight = await listSchoolDashboardKpis(
      repository,
      { role: "Admin School", schoolId: fixture.schoolB, permissions: ["Annonces:READ"] },
      { period: "daily" },
      crossing,
    );
    assert.equal(kinshasaNight.timeZone, "Africa/Kinshasa");
    assert.equal(kinshasaNight.periodLabel, "Quotidien · 05/11/2026 – 05/11/2026");
    assert.equal(newYorkNight.timeZone, "America/New_York");
    assert.equal(newYorkNight.periodLabel, "Quotidien · 04/11/2026 – 04/11/2026");
    assert.equal(aucklandNight.timeZone, "Pacific/Auckland");
    assert.equal(aucklandNight.periodLabel, "Quotidien · 05/11/2026 – 05/11/2026");

    const beforeMidnight = new Date("2026-11-04T22:30:00.000Z");
    const kinshasaBefore = await listSchoolDashboardKpis(repository, admin, { period: "daily" }, beforeMidnight);
    const aucklandBefore = await listSchoolDashboardKpis(
      repository,
      { role: "Admin School", schoolId: fixture.schoolB, permissions: ["Annonces:READ"] },
      { period: "daily" },
      beforeMidnight,
    );
    assert.equal(kinshasaBefore.periodLabel, "Quotidien · 04/11/2026 – 04/11/2026");
    assert.equal(aucklandBefore.periodLabel, "Quotidien · 05/11/2026 – 05/11/2026");

    const boundary = "2026-11-05T03:30:00.000Z";
    await pool.query(
      `INSERT INTO announcements (school_id, title, message, created_at)
       VALUES ($1, 'Frontiere', 'Minuit', $2), ($3, 'Frontiere', 'Minuit', $2)`,
      [fixture.schoolA, boundary, fixture.empty],
    );
    const probe = new Date("2026-11-05T06:00:00.000Z");
    const kinshasaProbe = await listSchoolDashboardKpis(repository, admin, { period: "daily" }, probe);
    const newYorkProbe = await listSchoolDashboardKpis(
      repository,
      { role: "Admin School", schoolId: fixture.empty, permissions: ["Annonces:READ"] },
      { period: "daily" },
      probe,
    );
    assert.equal(kinshasaProbe.timeZone, "Africa/Kinshasa");
    assert.equal(kinshasaProbe.series.announcements, 1);
    assert.equal(newYorkProbe.timeZone, "America/New_York");
    assert.equal(newYorkProbe.series.announcements, 0);

    await pool.query(
      `UPDATE schools SET profile_payload = profile_payload || '{"timezone":"Not/AZone"}'::jsonb WHERE id = $1`,
      [fixture.schoolB],
    );
    const invalidZone = await listSchoolDashboardKpis(
      repository,
      { role: "Admin School", schoolId: fixture.schoolB, permissions: ["Annonces:READ"] },
      { period: "daily" },
      beforeMidnight,
    );
    assert.equal(invalidZone.timeZone, "Africa/Kinshasa");
    assert.equal(invalidZone.periodLabel, "Quotidien · 04/11/2026 – 04/11/2026");

    const empty = await listSchoolDashboardKpis(
      repository,
      { role: "Admin School", schoolId: fixture.empty, permissions: ADMIN_RIGHTS },
      { period: "monthly" },
      NOW,
    );
    assert.equal(empty.cards.students, 0);
    assert.equal(empty.cards.teachers, 0);
    assert.equal(empty.cards.classes, 0);
    assert.equal(empty.cards.revenue.display, "—");
    assert.equal(empty.cards.attendance.value, "—");
    assert.equal(empty.cards.attendance.expected, 0);
    assert.equal(empty.cards.paymentRate.value, "—");
    assert.equal(empty.series.presence.total, 0);

    // Finance enseignant : seuls les élèves de ses classes, jamais toute l'école.
    const ids = await pool.query(
      `SELECT
         (SELECT id FROM students WHERE school_id = $1 AND student_code = 'A-S2') AS s2,
         (SELECT id FROM classes WHERE school_id = $1 AND class_code = 'A-6E') AS class6,
         (SELECT id FROM classes WHERE school_id = $1 AND class_code = 'A-5E') AS class5,
         (SELECT id FROM subjects WHERE school_id = $1 AND subject_code = 'A-MATH') AS subject,
         (SELECT id FROM academic_years WHERE school_id = $1 AND is_current = true LIMIT 1) AS year`,
      [fixture.schoolA],
    );
    const ref = ids.rows[0];
    await pool.query(
      `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method, payment_status, payment_date)
       VALUES ($1, $2, 'A-PAY-S2', 300, 'CDF', 'cash', 'paid', '2026-11-03')`,
      [fixture.schoolA, ref.s2],
    );
    await pool.query(
      `INSERT INTO student_fee_obligations
         (school_id, student_id, class_id, fee_type, label, currency, amount_due, amount_paid, exemption, balance, status)
       VALUES ($1, $2, $3, 'scolarite', 'S2-5E', 'CDF', 200, 100, 0, 100, 'Partiel')`,
      [fixture.schoolA, ref.s2, ref.class5],
    );
    const multiUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
       VALUES ($1, 'A-MULTI', 'Deux', 'Classes', 'Enseignant', 'active') RETURNING id`,
      [fixture.schoolA],
    );
    const multiTeacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code) VALUES ($1, $2, 'A-T2') RETURNING id`,
      [fixture.schoolA, multiUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $5, $6, 'active'), ($1, $2, $4, $5, $6, 'active')`,
      [fixture.schoolA, multiTeacher.rows[0].id, ref.class6, ref.class5, ref.subject, ref.year],
    );

    const adminFinance = await listSchoolDashboardKpis(repository, admin, { period: "monthly" }, NOW);
    assert.equal(adminFinance.cards.revenue.amount, 397);
    assert.equal(adminFinance.cards.paymentRate.expectedAmount, 370);
    assert.equal(adminFinance.cards.paymentRate.collectedAmount, 190);
    assert.equal(adminFinance.cards.paymentRate.value, "51 %");
    assert.equal(adminFinance.series.paymentAmounts.find((item) => item.name === "Payé").value, 390);

    const oneClass = await listSchoolDashboardKpis(
      repository,
      { role: "Enseignant", userId: fixture.teacherUserId, schoolId: fixture.schoolA, permissions: ADMIN_RIGHTS },
      { period: "monthly" },
      NOW,
    );
    assert.equal(oneClass.cards.students, 2);
    assert.equal(oneClass.cards.classes, 1);
    assert.equal(oneClass.cards.revenue.amount, 97);
    assert.equal(oneClass.cards.paymentRate.expectedAmount, 150);
    assert.equal(oneClass.cards.paymentRate.collectedAmount, 90);
    assert.equal(oneClass.cards.paymentRate.value, "60 %");
    assert.equal(oneClass.series.paymentAmounts.find((item) => item.name === "Payé").value, 90);
    assert.equal(oneClass.series.paymentStatus.reduce((total, item) => total + item.value, 0), 3);
    assert.equal(oneClass.series.activeStudents, 1);

    const twoClasses = await listSchoolDashboardKpis(
      repository,
      { role: "Enseignant", sub: multiUser.rows[0].id, schoolId: fixture.schoolA, permissions: ADMIN_RIGHTS },
      { period: "monthly" },
      NOW,
    );
    assert.equal(twoClasses.cards.students, 3);
    assert.equal(twoClasses.cards.classes, 2);
    assert.equal(twoClasses.cards.teachers, adminFinance.cards.teachers);
    assert.equal(twoClasses.cards.revenue.amount, 397);
    assert.equal(twoClasses.cards.paymentRate.value, "51 %");
    assert.equal(twoClasses.series.presence.total, 4);

    const stillClosed = await listSchoolDashboardKpis(
      repository,
      { role: "Enseignant", id: libreUser.rows[0].id, schoolId: fixture.schoolA, permissions: ADMIN_RIGHTS },
      { period: "monthly" },
      NOW,
    );
    assert.equal(stillClosed.cards.revenue.display, "—");
    assert.equal(stillClosed.cards.paymentRate.value, "—");
    assert.deepEqual(stillClosed.series.paymentAmounts, []);
    assert.equal(stillClosed.cards.students, 0);

    const foreignSchool = await listSchoolDashboardKpis(
      repository,
      { role: "Admin School", schoolId: fixture.schoolB, permissions: ADMIN_RIGHTS },
      { period: "monthly" },
      NOW,
    );
    assert.equal(foreignSchool.cards.revenue.amount, 500);
    assert.equal(foreignSchool.cards.students, 1);

    const listBytes = Object.values(fixture.volumes).reduce((total, value) => total + Number(value), 0);
    const kpiBytes = Buffer.byteLength(JSON.stringify(monthly));
    console.log(JSON.stringify({
      fixture: "perf-pr2-school-a",
      now: NOW.toISOString(),
      listBytes,
      volumes: fixture.volumes,
      kpiBytes,
      kpiRequestsPerCycle: 1,
      activityRequestsPerCycle: 1,
    }));
    assert.ok(kpiBytes < listBytes);
  } finally {
    await pool.end();
    await dropOwnedDisposableDatabase(DATABASE_URL, owned.databaseName, owned.token);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
