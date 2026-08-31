"use strict";

/**
 * P0 SYNC-END-TO-END — vérifie la chaîne réelle pour les domaines critiques :
 * POST/PATCH/DELETE → PostgreSQL → GET API → reload GET → cohérence.
 *
 * Exécution : DATABASE_URL=postgresql://... npm run verify:sync-end-to-end
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { FINANCE_SCHEMA_SQL } = require("../db/financeSchema");
const { hashSecret } = require("../services/credentialService");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19690;
const PG_DATABASE = String(process.env.SOMAFRIK_SYNC_E2E_DATABASE ?? "somafrik_sync_e2e_it")
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

async function prepareDatabase(databaseUrl, fixtureSecret) {
  const isolatedUrl = await ensureIsolatedDatabase(databaseUrl, PG_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const passwordHash = hashSecret(fixtureSecret);
  console.log("[sync-e2e] préparation base isolée", { database: PG_DATABASE });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    await pool.query(FINANCE_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const school = await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'Lycée SYNC-E2E', 'active') RETURNING id`,
      [country.rows[0].id],
    );
    const schoolId = school.rows[0].id;
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-SYNC-E2E', 'Admin', 'Sync', 'admin-sync-e2e@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolId, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'PREFET-SYNC-E2E', 'Samuel', 'Prefet', 'prefet-sync-e2e@test.cd', $2, $2, 'PREFET_ETUDES', 'active')`,
      [schoolId, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES (NULL, 'SUPER-SYNC-E2E', 'Super', 'Sync', 'super-sync-e2e@test.cd', $1, $1, 'SUPER_ADMIN', 'active')`,
      [passwordHash],
    );
    console.log("[sync-e2e] bootstrap Superadmin fixture", {
      identifier: "super-sync-e2e@test.cd",
      userCode: "SUPER-SYNC-E2E",
      role: "SUPER_ADMIN",
    });
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2025-2026', 'open') RETURNING id`,
      [schoolId],
    );
    const klass = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-SYNC-6A', '6ème A', 'active') RETURNING id`,
      [schoolId, year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active')`,
      [schoolId],
    );
    const teacherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ENS-SYNC-01', 'Paul', 'Prof', 'ens-sync-e2e@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolId, passwordHash],
    );
    const teacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ($1, $2, 'ENS-SYNC-01', 'active') RETURNING id`,
      [schoolId, teacherUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       SELECT $1, $2, $3, s.id, $4, 'active'
       FROM subjects s WHERE s.school_id = $1 AND s.subject_code = 'SUB-MATH'`,
      [schoolId, teacher.rows[0].id, klass.rows[0].id, year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open')`,
      [year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2025-09-01')`,
      [schoolId],
    );
  } finally {
    await pool.end();
  }
  return isolatedUrl;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl() {
  return `http://127.0.0.1:${PORT}/api`;
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl()}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

/** Contrat canonique — aligné sur verify-class-student-enrollment.js */
function studentEnrollPayload(overrides = {}) {
  return {
    firstName: "Awa",
    lastName: "Diop",
    gender: "Féminin",
    birthDate: "2012-04-12",
    ...overrides,
  };
}

async function login(identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.accessToken || result.data.token;
}

function spawnBackend(databaseUrl) {
  return spawn("node", ["backend/server.js"], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
      PORT: String(PORT),
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: process.env.JWT_SECRET || "verify-sync-end-to-end-test-secret-32chars",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early: ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl()}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(300);
  }
  throw new Error("Backend health timeout");
}

async function assertReloadStable(label, fetchList, pickId) {
  const first = extractList((await fetchList()).data);
  const second = extractList((await fetchList()).data);
  const ids1 = first.map(pickId).sort();
  const ids2 = second.map(pickId).sort();
  assert.deepEqual(ids1, ids2, `${label}: reload GET divergent`);
  return first;
}

/** login_code V2 de l'école fixture, via user_code enseignant — jamais leftover school_code. */
async function resolveCanonicalLoginCode(pool) {
  const row = await pool.query(
    `SELECT s.login_code
     FROM users u
     JOIN schools s ON s.id = u.school_id
     WHERE u.user_code = 'ENS-SYNC-01'
     LIMIT 1`,
  );
  assert.equal(row.rowCount, 1, "fixture ENS-SYNC-01 sans école");
  const loginCode = String(row.rows[0].login_code ?? "").trim().toUpperCase();
  assert.match(
    loginCode,
    /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2}-\d{3}$/,
    `login_code V2 attendu, reçu ${loginCode}`,
  );
  return loginCode;
}

/**
 * SYNC-E2E-ATTENDANCE-ASSIGNMENT-01 — ENS-SYNC-01 × classe canonique.
 * Présences admin exige une affectation active sur la classe ciblée.
 */
async function assignFixtureTeacherToCreatedClass(pool, { classCode, loginCode }) {
  const teacher = await pool.query(
    `SELECT t.id AS teacher_id, s.id AS school_id
     FROM users u
     JOIN teachers t ON t.user_id = u.id AND t.status = 'active'
     JOIN schools s ON s.id = u.school_id AND s.id = t.school_id
     WHERE u.user_code = 'ENS-SYNC-01'
       AND upper(s.login_code) = $1
     LIMIT 2`,
    [loginCode],
  );
  assert.equal(teacher.rowCount, 1, `ENS-SYNC-01 introuvable pour login_code ${loginCode}`);

  const klass = await pool.query(
    `SELECT cl.id AS class_id, cl.academic_year_id
     FROM classes cl
     JOIN schools s ON s.id = cl.school_id
     WHERE cl.class_code = $1 AND upper(s.login_code) = $2
     LIMIT 2`,
    [classCode, loginCode],
  );
  assert.equal(klass.rowCount, 1, `classe ${classCode} introuvable pour login_code ${loginCode}`);

  const subject = await pool.query(
    `SELECT sub.id AS subject_id
     FROM subjects sub
     JOIN schools s ON s.id = sub.school_id
     WHERE sub.subject_code = 'SUB-MATH' AND upper(s.login_code) = $1
     LIMIT 2`,
    [loginCode],
  );
  assert.equal(subject.rowCount, 1, `SUB-MATH introuvable pour login_code ${loginCode}`);

  const inserted = await pool.query(
    `INSERT INTO teacher_assignments (
       school_id, teacher_id, class_id, subject_id, academic_year_id, status
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'active')
     RETURNING id`,
    [
      teacher.rows[0].school_id,
      teacher.rows[0].teacher_id,
      klass.rows[0].class_id,
      subject.rows[0].subject_id,
      klass.rows[0].academic_year_id,
    ],
  );
  assert.equal(inserted.rowCount, 1, "INSERT teacher_assignments attendu");

  const active = await pool.query(
    `SELECT count(*)::int AS c
     FROM teacher_assignments
     WHERE teacher_id = $1::uuid
       AND class_id = $2::uuid
       AND status = 'active'`,
    [teacher.rows[0].teacher_id, klass.rows[0].class_id],
  );
  assert.equal(
    active.rows[0].c,
    1,
    "exactement une affectation active ENS-SYNC-01 × classe canonique",
  );
}

async function runSyncEndToEnd(databaseUrl) {
  const fixtureSecret = `SyncE2e!${crypto.randomBytes(16).toString("hex")}`;
  console.log("[sync-e2e] identifier attendu: super-sync-e2e@test.cd (pas superadmin)");
  console.log("[sync-e2e] password attendu: secret de fixture généré pour cette exécution (hash scrypt, pas 1234)");
  const isolatedUrl = await prepareDatabase(databaseUrl, fixtureSecret);
  const pool = new Pool({ connectionString: isolatedUrl });
  const child = spawnBackend(isolatedUrl);
  const stamp = Date.now();

  try {
    await waitForHealth(child);
    console.log("[sync-e2e] login HTTP réel", { identifier: "admin-sync-e2e@test.cd", schoolCode: "CD-2026-0001" });
    const adminToken = await login("admin-sync-e2e@test.cd", fixtureSecret, "CD-2026-0001");
    console.log("[sync-e2e] login HTTP réel", { identifier: "prefet-sync-e2e@test.cd", schoolCode: "CD-2026-0001" });
    const prefetToken = await login("prefet-sync-e2e@test.cd", fixtureSecret, "CD-2026-0001");
    console.log("[sync-e2e] login HTTP réel", { identifier: "super-sync-e2e@test.cd" });
    const superToken = await login("super-sync-e2e@test.cd", fixtureSecret);

    // --- Users : identité d'abord, rôle ensuite ---
    const userEmail = `sec-sync-${stamp}@test.cd`;
    const createdUser = await request("/backoffice/users", {
      method: "POST",
      token: adminToken,
      body: {
        firstName: "User",
        lastName: `Sync${stamp}`,
        email: userEmail,
        temporaryPassword: "E2eTest!2026",
      },
    });
    assert.equal(createdUser.status, 201, JSON.stringify(createdUser.data));
    const userId = String(createdUser.data.id ?? "");
    assert.ok(userId, "UUID serveur users");
    assert.deepEqual(createdUser.data.roleKeys ?? [], [], "users: création sans rôle");
    const grantSecretary = await request(`/backoffice/users/${encodeURIComponent(userId)}/roles/grant`, {
      method: "POST",
      token: adminToken,
      body: { role: "Secrétaire" },
    });
    assert.equal(grantSecretary.status, 200, JSON.stringify(grantSecretary.data));
    assert.ok((grantSecretary.data.roleKeys ?? []).includes("SECRETARY"), "users: rôle Secrétaire attribué");
    const pgUser = await pool.query(`SELECT count(*)::int AS c FROM users WHERE id = $1 AND email = $2`, [userId, userEmail]);
    assert.equal(pgUser.rows[0].c, 1, "users: ligne PostgreSQL");
    const pgSecretaryRole = await pool.query(
      `SELECT count(*)::int AS c FROM user_roles WHERE user_id = $1 AND role_key = 'SECRETARY' AND status = 'active'`,
      [userId],
    );
    assert.equal(pgSecretaryRole.rows[0].c, 1, "users: GRANT PostgreSQL");
    let usersGet = await assertReloadStable(
      "users",
      () => request("/backoffice/users", { token: adminToken }),
      (row) => String(row.id),
    );
    assert.ok(usersGet.some((row) => String(row.id) === userId), "users: GET contient POST");
    const patchedUser = await request(`/backoffice/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Inactif" },
    });
    assert.equal(patchedUser.status, 200, JSON.stringify(patchedUser.data));
    usersGet = extractList((await request("/backoffice/users", { token: adminToken })).data);
    const patched = usersGet.find((row) => String(row.id) === userId);
    assert.equal(patched?.status, "Inactif", "users: PATCH reflété par GET");

    // --- Teachers : identité utilisateur + GRANT Enseignant ---
    const teacherEmail = `teacher-sync-${stamp}@test.cd`;
    const teacherIdentity = await request("/backoffice/users", {
      method: "POST",
      token: adminToken,
      body: {
        firstName: "Marie",
        lastName: `Sync${stamp}`,
        email: teacherEmail,
        phone: `+243820${String(stamp).slice(-6)}`,
        temporaryPassword: "TeacherSync!2026",
      },
    });
    assert.equal(teacherIdentity.status, 201, JSON.stringify(teacherIdentity.data));
    const teacherUserId = String(teacherIdentity.data.id ?? "");
    assert.ok(teacherUserId, "teachers: UUID identité serveur");
    const grantTeacher = await request(`/backoffice/users/${encodeURIComponent(teacherUserId)}/roles/grant`, {
      method: "POST",
      token: adminToken,
      body: { role: "Enseignant" },
    });
    assert.equal(grantTeacher.status, 200, JSON.stringify(grantTeacher.data));
    assert.ok((grantTeacher.data.roleKeys ?? []).includes("TEACHER"), "teachers: rôle Enseignant attribué");
    let teachersGet = await assertReloadStable(
      "teachers",
      () => request("/teachers", { token: adminToken }),
      (row) => String(row.teacherCode ?? row.id),
    );
    const createdTeacher = teachersGet.find((row) => String(row.userId) === teacherUserId);
    assert.ok(createdTeacher, "teachers: GET contient le profil créé par GRANT");
    const teacherCode = String(createdTeacher.teacherCode ?? createdTeacher.id ?? "");
    assert.ok(teacherCode, "teachers: teacherCode canonique");
    const pgTeacher = await pool.query(`SELECT count(*)::int AS c FROM teachers WHERE user_id = $1 AND teacher_code = $2`, [
      teacherUserId,
      teacherCode,
    ]);
    assert.equal(pgTeacher.rows[0].c, 1, "teachers: PostgreSQL");
    const deletedTeacher = await request(`/teachers/${encodeURIComponent(teacherCode)}`, {
      method: "DELETE",
      token: prefetToken,
    });
    assert.equal(deletedTeacher.status, 200, JSON.stringify(deletedTeacher.data));
    assert.equal(deletedTeacher.data?.archived, true, "teachers: DELETE archive");
    teachersGet = extractList((await request("/teachers", { token: adminToken })).data);
    assert.ok(
      !teachersGet.some((row) => String(row.teacherCode ?? row.id) === teacherCode),
      "teachers: DELETE absent du GET",
    );

    // --- Classes ---
    const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");
    const offering = await prepareCanonicalClassContext(request, {
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      superToken,
      schoolToken: adminToken,
      groupCode: "SY",
    });
    const createdClass = await postCanonicalClass(request, adminToken, {
      academicYearId: offering.academicYear.id,
      levelId: offering.level.id,
      groupId: offering.group.id,
      status: "active",
    });
    assert.equal(createdClass.status, 201, JSON.stringify(createdClass.data));
    const classCode = String(createdClass.data.classCode ?? "");
    const pgClass = await pool.query(`SELECT count(*)::int AS c FROM classes WHERE class_code = $1`, [classCode]);
    assert.equal(pgClass.rows[0].c, 1, "classes: PostgreSQL");
    let classesGet = await assertReloadStable(
      "classes",
      () => request("/classes", { token: adminToken }),
      (row) => String(row.classCode ?? row.id),
    );
    assert.ok(classesGet.some((row) => String(row.classCode) === classCode), "classes: GET contient POST");

    // --- Students ---
    const enrolled = await request(`/classes/${encodeURIComponent(classCode)}/students`, {
      method: "POST",
      token: adminToken,
      body: studentEnrollPayload(),
    });
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    const studentCode = String(
      enrolled.data.student?.studentCode ?? enrolled.data.studentCode ?? enrolled.data.id ?? "",
    );
    const pgStudent = await pool.query(`SELECT count(*)::int AS c FROM students WHERE student_code = $1`, [studentCode]);
    assert.equal(pgStudent.rows[0].c, 1, "students: PostgreSQL");
    let studentsGet = await assertReloadStable(
      "students",
      () => request("/students", { token: adminToken }),
      (row) => String(row.studentCode ?? row.id),
    );
    assert.ok(
      studentsGet.some((row) => String(row.studentCode ?? row.id) === studentCode),
      "students: GET contient POST",
    );

    // --- Notes / Présences (évaluation requise) ---
    const evaluation = await request("/evaluations", {
      method: "POST",
      token: adminToken,
      body: {
        className: createdClass.data.name,
        subject: "Mathématiques",
        period: "Trimestre 1",
        title: `Eval Sync ${stamp}`,
        teacherId: "ENS-SYNC-01",
        evaluationType: "Devoir",
        scale: 20,
      },
    });
    assert.equal(evaluation.status, 201, JSON.stringify(evaluation.data));
    const evaluationId = String(evaluation.data.id ?? "");

    const validated = await request(`/evaluations/${encodeURIComponent(evaluationId)}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "Validée" },
    });
    assert.equal(validated.status, 200, JSON.stringify(validated.data));
    assert.equal(validated.data?.status, "Validée");

    const notePost = await request("/notes", {
      method: "POST",
      token: adminToken,
      body: {
        evaluationId,
        studentId: studentCode,
        teacherId: "ENS-SYNC-01",
        value: 14,
        scale: 20,
      },
    });
    assert.equal(notePost.status, 201, JSON.stringify(notePost.data));
    const noteId = String(notePost.data.id ?? "");
    const pgNote = await pool.query(
      `SELECT count(*)::int AS c FROM grades g
       WHERE g.id::text = $1`,
      [noteId],
    );
    assert.ok(pgNote.rows[0].c >= 1, "notes: PostgreSQL");
    let notesGet = await assertReloadStable(
      "notes",
      () => request("/notes", { token: adminToken }),
      (row) => String(row.id),
    );
    assert.ok(notesGet.some((row) => String(row.id) === noteId), "notes: GET contient POST");
    await pool.query(`DELETE FROM grades WHERE id::text = $1`, [noteId]);
    notesGet = extractList((await request("/notes", { token: adminToken })).data);
    assert.ok(!notesGet.some((row) => String(row.id) === noteId), "notes: suppression PG reflétée par GET");

    const CANONICAL_LOGIN_CODE = await resolveCanonicalLoginCode(pool);
    await assignFixtureTeacherToCreatedClass(pool, {
      classCode,
      loginCode: CANONICAL_LOGIN_CODE,
    });

    const presencePost = await request("/presences", {
      method: "POST",
      token: adminToken,
      body: {
        items: [
          {
            studentId: studentCode,
            className: createdClass.data.name,
            date: "2026-09-15",
            status: "present",
            teacherId: "ENS-SYNC-01",
          },
        ],
      },
    });
    assert.equal(presencePost.status, 201, JSON.stringify(presencePost.data));
    const presenceRows = Array.isArray(presencePost.data) ? presencePost.data : [presencePost.data];
    const presenceId = String(presenceRows[0]?.id ?? "");
    const pgPresence = await pool.query(
      `SELECT count(*)::int AS c FROM attendance a
       JOIN students s ON s.id = a.student_id
       WHERE s.student_code = $1 AND a.attendance_date = '2026-09-15'`,
      [studentCode],
    );
    assert.ok(pgPresence.rows[0].c >= 1, "presences: PostgreSQL");
    let presencesGet = await assertReloadStable(
      "presences",
      () => request("/presences", { token: adminToken }),
      (row) => `${row.studentId}|${row.date}|${row.status}`,
    );
    assert.ok(
      presencesGet.some((row) => String(row.studentId) === studentCode && String(row.date) === "2026-09-15"),
      "presences: GET contient POST",
    );
    if (presenceId) {
      await pool.query(`DELETE FROM attendance WHERE id::text = $1`, [presenceId]);
    } else {
      await pool.query(
        `DELETE FROM attendance a USING students s
         WHERE s.id = a.student_id AND s.student_code = $1 AND a.attendance_date = '2026-09-15'`,
        [studentCode],
      );
    }
    presencesGet = extractList((await request("/presences", { token: adminToken })).data);
    assert.ok(
      !presencesGet.some((row) => String(row.studentId) === studentCode && String(row.date) === "2026-09-15"),
      "presences: suppression PG reflétée par GET",
    );

    // --- Finance (paiement) ---
    const feeGrid = await request("/finance/fee-grids", {
      method: "POST",
      token: adminToken,
      body: {
        className: createdClass.data.name,
        academicYear: "2025-2026",
        currency: "CDF",
        items: [
          {
            feeType: "Inscription",
            label: "Inscription",
            amount: 10_000,
            dueDate: "2026-01-01",
            status: "Actif",
          },
        ],
      },
    });
    assert.equal(feeGrid.status, 201, JSON.stringify(feeGrid.data));
    const activatedGrid = await request(`/finance/fee-grids/${encodeURIComponent(feeGrid.data.id)}/activate`, {
      method: "POST",
      token: adminToken,
    });
    assert.equal(activatedGrid.status, 200, JSON.stringify(activatedGrid.data));
    const appliedGrid = await request(`/finance/fee-grids/${encodeURIComponent(feeGrid.data.id)}/apply`, {
      method: "POST",
      token: adminToken,
    });
    assert.equal(appliedGrid.status, 200, JSON.stringify(appliedGrid.data));

    const feesBeforePay = await request("/finance/student-fees", { token: adminToken });
    assert.equal(feesBeforePay.status, 200, JSON.stringify(feesBeforePay.data));
    const feeRows = Array.isArray(feesBeforePay.data) ? feesBeforePay.data : feesBeforePay.data?.items ?? [];
    const enrolledStudentId = String(enrolled.data.student?.id ?? enrolled.data.id ?? "");
    const openObligations = feeRows.filter(
      (row) =>
        (row.studentId === studentCode || row.studentId === enrolledStudentId) &&
        String(row.status) !== "Annulé" &&
        Number(row.balance || 0) > 0,
    );
    const inscriptionObligation =
      openObligations.find((row) => String(row.feeType) === "Inscription") ?? openObligations[0];
    assert.ok(inscriptionObligation?.id, "obligation Inscription absente avant imputation");

    const paymentPost = await request("/payments", {
      method: "POST",
      token: adminToken,
      body: {
        studentId: studentCode,
        items: [
          {
            obligationId: inscriptionObligation.id,
            feeType: "Inscription",
            amount: 10_000,
          },
        ],
        method: "Espèces",
        date: "2026-08-13",
      },
    });
    assert.equal(paymentPost.status, 201, JSON.stringify(paymentPost.data));
    const paymentRef = String(paymentPost.data.reference ?? paymentPost.data.id ?? "");
    const pgPayment = await pool.query(
      `SELECT count(*)::int AS c FROM payments p
       JOIN schools s ON s.id = p.school_id
       WHERE s.school_code = 'CD-2026-0001' AND (p.payment_code = $1 OR p.id::text = $1)`,
      [paymentRef],
    );
    assert.ok(pgPayment.rows[0].c >= 1, "payments: PostgreSQL");
    let paymentsGet = await assertReloadStable(
      "payments",
      () => request("/payments", { token: adminToken }),
      (row) => String(row.reference ?? row.id),
    );
    assert.ok(
      paymentsGet.some((row) => String(row.reference ?? row.id) === paymentRef),
      "payments: GET contient POST",
    );
    await pool.query(
      `DELETE FROM payment_allocations pa
       USING payments p, schools s
       WHERE pa.payment_id = p.id
         AND p.school_id = s.id
         AND s.school_code = 'CD-2026-0001'
         AND (p.payment_code = $1 OR p.id::text = $1)`,
      [paymentRef],
    );
    await pool.query(
      `DELETE FROM payments p USING schools s
       WHERE p.school_id = s.id AND s.school_code = 'CD-2026-0001'
         AND (p.payment_code = $1 OR p.id::text = $1)`,
      [paymentRef],
    );
    paymentsGet = extractList((await request("/payments", { token: adminToken })).data);
    assert.ok(
      !paymentsGet.some((row) => String(row.reference ?? row.id) === paymentRef),
      "payments: suppression PG reflétée par GET",
    );

    // --- Notifications ---
    const notifPost = await request("/backoffice/notifications", {
      method: "POST",
      token: superToken,
      body: {
        title: `Notif Sync ${stamp}`,
        message: "Test convergence",
        type: "Information",
        audience: "etablissement",
        schoolCode: "CD-2026-0001",
        status: "Non lu",
      },
    });
    assert.equal(notifPost.status, 201, JSON.stringify(notifPost.data));
    const notifId = String(notifPost.data.id ?? "");
    const pgNotif = await pool.query(
      `SELECT count(*)::int AS c FROM notifications n
       LEFT JOIN schools s ON s.id = n.school_id
       WHERE n.id::text = $1 OR n.title = $2`,
      [notifId, `Notif Sync ${stamp}`],
    );
    assert.ok(pgNotif.rows[0].c >= 1, "notifications: PostgreSQL");
    let notifsGet = await assertReloadStable(
      "notifications",
      () => request("/backoffice/notifications", { token: superToken }),
      (row) => String(row.id),
    );
    assert.ok(notifsGet.some((row) => String(row.id) === notifId), "notifications: GET contient POST");
    await pool.query(`DELETE FROM notifications WHERE id::text = $1 OR title = $2`, [
      notifId,
      `Notif Sync ${stamp}`,
    ]);
    notifsGet = extractList((await request("/backoffice/notifications", { token: superToken })).data);
    assert.ok(!notifsGet.some((row) => String(row.id) === notifId), "notifications: suppression PG reflétée par GET");

    console.log("OK verify:sync-end-to-end — Users, Teachers, Students, Classes, Notes, Presences, Finance, Notifications");
  } finally {
    child.kill("SIGTERM");
    await pool.end().catch(() => {});
    await wait(300);
  }
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    console.log("verify-sync-end-to-end.js: SKIP (DATABASE_URL absent — exécuter en CI PostgreSQL)");
    return;
  }
  await runSyncEndToEnd(databaseUrl);
}

main().catch((error) => {
  console.error("FAIL verify:sync-end-to-end:", error.message || error);
  process.exit(1);
});