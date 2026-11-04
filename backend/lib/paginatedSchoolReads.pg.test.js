"use strict";

/**
 * PERF-PR3 — pagination SQL des présences, notes et paiements sur PostgreSQL réel.
 * Deux établissements, historique sur trois années scolaires, égalités de date.
 */

const assert = require("node:assert/strict");
const { createPostgresRepository } = require("../db/repositoryFactory");
const reads = require("./paginatedSchoolReads");
const { teacherClassIds } = require("./schoolDashboardKpis");
const {
  assertOwnedDisposable,
  createOwnedDisposableDatabase,
  dropOwnedDisposableDatabase,
} = require("./perfPr1DisposableDatabase");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const DAYS = ["2024-03-11", "2025-03-10", "2026-03-09", "2026-11-03", "2026-11-04"];

async function seedSchool(pool, country, code, { classes, studentsPerClass, payments }) {
  const school = (
    await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [country, code, `${code}-L`, `Ecole ${code}`],
    )
  ).rows[0].id;
  const year = (
    await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current, status) VALUES ($1, '2026-2027', true, 'open') RETURNING id`,
      [school],
    )
  ).rows[0].id;
  const term = (
    await pool.query(`INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'T1', 'open') RETURNING id`, [year])
  ).rows[0].id;
  const subject = (
    await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name) VALUES ($1, $2, 'Mathématiques') RETURNING id`,
      [school, `${code}-MATH`],
    )
  ).rows[0].id;
  const user = (
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
       VALUES ($1, $2, 'Prof', $3, 'Enseignant', 'active') RETURNING id`,
      [school, `${code}-PROF`, code],
    )
  ).rows[0].id;
  const teacher = (
    await pool.query(`INSERT INTO teachers (school_id, user_id, teacher_code) VALUES ($1, $2, $3) RETURNING id`, [
      school,
      user,
      `${code}-T1`,
    ])
  ).rows[0].id;
  const classIds = [];
  const students = [];
  for (let c = 0; c < classes; c += 1) {
    const classId = (
      await pool.query(
        `INSERT INTO classes (school_id, academic_year_id, class_code, name, level)
         VALUES ($1, $2, $3, $4, '6e') RETURNING id`,
        [school, year, `${code}-C${c}`, `6e ${code}${c}`],
      )
    ).rows[0].id;
    classIds.push(classId);
    for (let s = 0; s < studentsPerClass; s += 1) {
      const studentCode = `${code}-S${c}-${s}`;
      // Le trigger d'identité permanente peut réécrire student_code : garder la valeur stockée.
      const inserted = (
        await pool.query(
          `INSERT INTO students (school_id, student_code, first_name, last_name, status)
           VALUES ($1, $2, $3, $4, 'active') RETURNING id, student_code`,
          [school, studentCode, `Prenom${s}`, `Nom${code}${c}`],
        )
      ).rows[0];
      const student = inserted.id;
      await pool.query(
        `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
         VALUES ($1, $2, $3, $4, 'enrolled')`,
        [school, student, classId, year],
      );
      students.push({ id: student, code: inserted.student_code, classId });
    }
  }
  const statuses = ["present", "absent", "late", "excused"];
  let n = 0;
  for (const day of DAYS) {
    for (const student of students) {
      await pool.query(
        `INSERT INTO attendance (school_id, student_id, class_id, teacher_id, attendance_date, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [school, student.id, student.classId, teacher, day, statuses[n % 4]],
      );
      n += 1;
    }
  }
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [school, teacher, classIds[0], subject, year],
  );
  const evaluation = (
    await pool.query(
      `INSERT INTO evaluations (school_id, class_id, subject_id, teacher_id, term_id, title, coefficient, status)
       VALUES ($1, $2, $3, $4, $5, 'Devoir', 1, 'published') RETURNING id`,
      [school, classIds[0], subject, teacher, term],
    )
  ).rows[0].id;
  for (const student of students) {
    await pool.query(
      `INSERT INTO grades (school_id, student_id, class_id, subject_id, teacher_id, term_id, evaluation_id,
                           grade_type, score, grade_status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'devoir', 12, 'graded', '2026-11-04T08:00:00Z')`,
      [school, student.id, student.classId, subject, teacher, term, evaluation],
    );
  }
  for (let p = 0; p < payments; p += 1) {
    const student = students[p % students.length];
    await pool.query(
      `INSERT INTO payments (school_id, student_id, payment_code, amount, currency, payment_method,
                             payment_status, payment_date, created_at)
       VALUES ($1, $2, $3, $4, 'CDF', 'cash', 'paid', $5, '2026-11-04T09:00:00Z')`,
      [school, student.id, `${code}-PAY-${p}`, 10 + p, DAYS[p % DAYS.length]],
    );
  }
  return { school, classIds, students, teacherUser: user };
}

async function collect(fetchPage, limit) {
  const all = [];
  let cursor;
  let pages = 0;
  for (;;) {
    const page = await fetchPage({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    pages += 1;
    assert.equal(page.hasMore, page.nextCursor !== null);
    assert.ok(page.items.length <= limit);
    all.push(...page.items);
    if (!page.hasMore) break;
    cursor = page.nextCursor;
    assert.ok(pages < 500, "pagination sans fin");
  }
  return { all, pages };
}

function assertNoDuplicates(rows) {
  const ids = rows.map((row) => String(row.dbId ?? row.id));
  assert.equal(new Set(ids).size, ids.length, "doublon entre deux pages");
}

async function main() {
  if (!DATABASE_URL) {
    console.log("paginatedSchoolReads.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  const owned = await createOwnedDisposableDatabase(DATABASE_URL);
  await assertOwnedDisposable(owned.pool, owned.databaseName, owned.token);
  await owned.pool.end();
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  const repo = createPostgresRepository(owned.connectionString);
  try {
    await repo.init();
    const pool = repo.pool;
    const country = (
      await pool.query(
        `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
      )
    ).rows[0].id;
    const A = await seedSchool(pool, country, "PGA", { classes: 3, studentsPerClass: 9, payments: 23 });
    const B = await seedSchool(pool, country, "PGB", { classes: 1, studentsPerClass: 4, payments: 5 });
    const ctxA = { schoolId: A.school, classIds: null };
    const ctxB = { schoolId: B.school, classIds: null };

    // Présences : toutes les pages = toute la base de l'école A, sans doublon, ordre strict.
    const totalA = Number((await pool.query(`SELECT count(*) FROM attendance WHERE school_id = $1`, [A.school])).rows[0].count);
    const presences = await collect((q) => reads.listPresencesPage(repo, ctxA, q), 7);
    assert.equal(presences.all.length, totalA);
    assertNoDuplicates(presences.all);
    assert.ok(presences.pages > 2, "plusieurs pages, dont intermédiaires");
    const dbOrder = (
      await pool.query(
        `SELECT id::text FROM attendance WHERE school_id = $1 ORDER BY attendance_date DESC, id DESC`,
        [A.school],
      )
    ).rows.map((row) => row.id);
    assert.deepEqual(presences.all.map((row) => String(row.id)), dbOrder, "ordre stable (date, id)");
    assert.ok(presences.all.every((row) => String(row.schoolId) === A.school), "aucune ligne d'une autre école");

    // Parité exacte avec la projection historique, pour les mêmes lignes.
    const historic = await repo.listPedagogyProjection({ schoolId: A.school });
    const historicById = new Map(historic.presences.map((row) => [String(row.id), row]));
    for (const row of presences.all) {
      const old = historicById.get(String(row.id));
      assert.ok(old, `présence ${row.id} absente de la projection historique`);
      const { classCode: _newCode, ...rest } = row;
      const { classCode: _oldCode, ...oldRest } = old;
      assert.deepEqual(rest, oldRest, "DTO présence identique à la route historique");
    }

    // Filtres : jour, classe, élève, statut, identifiant, période, page vide.
    const today = await collect((q) => reads.listPresencesPage(repo, ctxA, { ...q, date: "2026-11-04" }), 50);
    assert.equal(today.all.length, A.students.length, "registre du jour complet");
    assert.ok(today.all.every((row) => row.date === "2026-11-04"));
    const oneClass = await reads.listPresencesPage(repo, ctxA, { date: "2026-11-04", classId: A.classIds[1], limit: "200" });
    assert.equal(oneClass.items.length, 9);
    const oneStudent = await reads.listPresencesPage(repo, ctxA, { studentId: A.students[0].code, limit: "200" });
    assert.equal(oneStudent.items.length, DAYS.length, "historique pluriannuel d'un élève");
    const absent = await collect((q) => reads.listPresencesPage(repo, ctxA, { ...q, status: "Absent" }), 50);
    assert.ok(absent.all.length > 0 && absent.all.every((row) => row.status === "Absent"));
    const present = await collect((q) => reads.listPresencesPage(repo, ctxA, { ...q, status: "Présent" }), 50);
    assert.ok(present.all.every((row) => row.status === "Présent"));
    const byId = await reads.listPresencesPage(repo, ctxA, { attendanceId: String(presences.all[3].id) });
    assert.deepEqual(byId.items.map((row) => String(row.id)), [String(presences.all[3].id)]);
    const range = await collect((q) => reads.listPresencesPage(repo, ctxA, { ...q, from: "2025-01-01", to: "2026-03-31" }), 50);
    assert.equal(range.all.length, A.students.length * 2);
    const empty = await reads.listPresencesPage(repo, ctxA, { date: "2023-01-02" });
    assert.deepEqual(empty, { items: [], nextCursor: null, hasMore: false });
    const ascending = await collect((q) => reads.listPresencesPage(repo, ctxA, { ...q, sort: "date" }), 11);
    assert.deepEqual(ascending.all.map((row) => String(row.id)), [...dbOrder].reverse());

    // Écriture entre deux pages : ni doublon ni saut pour les lignes existantes.
    const first = await reads.listPresencesPage(repo, ctxA, { limit: "5" });
    await pool.query(
      `INSERT INTO attendance (school_id, student_id, class_id, attendance_date, status)
       VALUES ($1, $2, $3, '2026-11-05', 'present')`,
      [A.school, A.students[2].id, A.students[2].classId],
    );
    const rest = await collect(
      (q) => reads.listPresencesPage(repo, ctxA, { ...q, ...(q.cursor ? {} : { cursor: first.nextCursor }) }),
      5,
    );
    const merged = [...first.items, ...rest.all];
    assertNoDuplicates(merged);
    assert.equal(merged.length, totalA, "lignes existantes toutes vues une fois, la nouvelle ligne n'est pas rejouée");

    // Curseur lié aux filtres et à l'établissement.
    await assert.rejects(
      reads.listPresencesPage(repo, ctxA, { cursor: first.nextCursor, date: "2026-11-04" }),
      (error) => error.statusCode === 400,
    );
    await assert.rejects(
      reads.listPresencesPage(repo, ctxB, { cursor: first.nextCursor }),
      (error) => error.statusCode === 400,
    );

    // École B isolée.
    const bAll = await collect((q) => reads.listPresencesPage(repo, ctxB, q), 50);
    assert.equal(bAll.all.length, 4 * DAYS.length);
    assert.ok(bAll.all.every((row) => String(row.schoolId) === B.school));

    // Enseignant : seule sa classe affectée ; sans affectation, rien et aucune requête de liste.
    const teacherCtx = await reads.resolveReadContext(
      repo,
      { role: "Enseignant", userId: A.teacherUser },
      { schoolId: A.school },
      teacherClassIds,
    );
    assert.deepEqual(teacherCtx.classIds, [A.classIds[0]]);
    const teacherPage = await collect((q) => reads.listPresencesPage(repo, teacherCtx, q), 50);
    assert.ok(teacherPage.all.length > 0);
    assert.ok(teacherPage.all.every((row) => String(row.classId) === A.classIds[0]));
    const bareTeacher = await reads.resolveReadContext(
      repo,
      { role: "Enseignant", userId: B.teacherUser },
      { schoolId: A.school },
      teacherClassIds,
    );
    assert.deepEqual(bareTeacher.classIds, []);
    assert.deepEqual(await reads.listPresencesPage(repo, bareTeacher, {}), { items: [], nextCursor: null, hasMore: false });
    assert.deepEqual(await reads.listPaymentsPage(repo, bareTeacher, {}), { items: [], nextCursor: null, hasMore: false });
    assert.deepEqual(await reads.listNotesPage(repo, bareTeacher, {}), { items: [], nextCursor: null, hasMore: false });

    // Notes : pagination complète et DTO identique à la projection historique.
    const notes = await collect((q) => reads.listNotesPage(repo, ctxA, q), 4);
    assert.equal(notes.all.length, A.students.length);
    assertNoDuplicates(notes.all);
    const historicNotes = new Map(historic.notes.map((row) => [String(row.id), row]));
    for (const row of notes.all) assert.deepEqual(row, historicNotes.get(String(row.id)), "DTO note identique");
    const teacherNotes = await collect((q) => reads.listNotesPage(repo, teacherCtx, q), 50);
    assert.equal(teacherNotes.all.length, 9);

    // Paiements : pagination, recherche, isolation et DTO identique à la projection historique.
    const payments = await collect((q) => reads.listPaymentsPage(repo, ctxA, q), 6);
    assert.equal(payments.all.length, 23);
    assertNoDuplicates(payments.all);
    const finance = await repo.listFinanceProjection({ schoolId: A.school });
    const historicPayments = new Map(finance.payments.map((row) => [String(row.dbId), row]));
    for (const row of payments.all) {
      const old = historicPayments.get(String(row.dbId));
      assert.ok(old, `paiement ${row.dbId} absent de la projection historique`);
      const { studentName: _n, className: _c, ...rest } = row;
      const { studentName: _on, className: _oc, ...oldRest } = old;
      assert.deepEqual(rest, oldRest, "DTO paiement identique");
      assert.ok(row.studentName.startsWith("Prenom"), "nom d'élève renseigné");
    }
    const byMatricule = await reads.listPaymentsPage(repo, ctxA, { q: A.students[1].code });
    assert.ok(byMatricule.items.length >= 1);
    assert.ok(byMatricule.items.every((row) => row.studentId === A.students[1].code));
    const wildcard = await reads.listPaymentsPage(repo, ctxA, { q: "%" });
    assert.equal(wildcard.items.length, 0, "% n'est pas un joker");
    const bPayments = await collect((q) => reads.listPaymentsPage(repo, ctxB, q), 50);
    assert.equal(bPayments.all.length, 5);
    const teacherPayments = await collect((q) => reads.listPaymentsPage(repo, teacherCtx, q), 50);
    const classZero = new Set(A.students.filter((s) => s.classId === A.classIds[0]).map((s) => s.code));
    assert.ok(teacherPayments.all.length > 0 && teacherPayments.all.every((row) => classZero.has(row.studentId)));

    console.log(
      JSON.stringify({
        test: "paginatedSchoolReads.pg",
        presencesA: totalA,
        presencePages: presences.pages,
        notes: notes.all.length,
        payments: payments.all.length,
      }),
    );
  } finally {
    await repo.close().catch(() => {});
    await dropOwnedDisposableDatabase(DATABASE_URL, owned.databaseName, owned.token);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
