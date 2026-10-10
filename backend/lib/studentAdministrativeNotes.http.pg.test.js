"use strict";

/**
 * FICHE-FIX-01 — PATCH /api/students/:code persiste administrative_notes.
 * Fixtures jetables, base isolée, aucun élève réel.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_FICHE_FIX01_IT_DATABASE ?? "somafrik_fiche_fix01_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_FICHE_FIX01_HTTP_PORT ?? 19890);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";
const USER_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd01";
const USER_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd02";
const USER_TEACHER = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";
const USER_READER = "dddddddd-dddd-4ddd-8ddd-dddddddddd04";
const USER_SUPER = "dddddddd-dddd-4ddd-8ddd-dddddddddd05";
const USER_PAYS = "dddddddd-dddd-4ddd-8ddd-dddddddddd06";
const USER_PARENT = "dddddddd-dddd-4ddd-8ddd-dddddddddd07";
const CLASS_A = "CD-LAC-CLS-FIX01";
const STUDENT_A = "dddddddd-dddd-4ddd-8ddd-dddddddddd11";
const STUDENT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddd12";
const NOTE_A = "NOTE-FIXTURE-ALPHA";
const NOTE_B = "NOTE-FIXTURE-BETA";

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

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
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

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function setLoginCodeTriggers(pool, enabled) {
  const action = enabled ? "ENABLE" : "DISABLE";
  await pool.query(`
    DO $trg$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_insert') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_insert';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_schools_login_code_update') THEN
        EXECUTE 'ALTER TABLE schools ${action} TRIGGER zz_schools_login_code_update';
      END IF;
    END
    $trg$;
  `);
}

async function ensureCountry(pool, name, iso, phone, currency) {
  const existing = await pool.query(`SELECT id FROM countries WHERE iso_code = $1 LIMIT 1`, [iso]);
  if (existing.rowCount) return existing.rows[0];
  const inserted = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, iso, phone, currency],
  );
  return inserted.rows[0];
}

async function seed(pool) {
  await setLoginCodeTriggers(pool, false);
  const cd = await ensureCountry(pool, "RDC", "CD", "+243", "CDF");
  const bi = await ensureCountry(pool, "Burundi", "BI", "+257", "BIF");
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'LAC', 'Lycee Fixture A', 'active')
     RETURNING id`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycee Fixture B', 'active')
     RETURNING id`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  await setLoginCodeTriggers(pool, true);
  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $6, 'ADM-FIX-A', 'Admin', 'A', 'a@fiche-fix01.test', 'Admin School', 'active', FALSE),
       ($2, $7, 'ADM-FIX-B', 'Admin', 'B', 'b@fiche-fix01.test', 'Admin School', 'active', FALSE),
       ($3, $6, 'ENS-FIX-A', 'Teacher', 'A', 't@fiche-fix01.test', 'Enseignant', 'active', FALSE),
       ($4, NULL, 'SUPER-FIX', 'Super', 'A', 'super@fiche-fix01.test', 'Super Administrateur Somafrik', 'active', FALSE),
       ($5, NULL, 'PAYS-FIX', 'Pays', 'A', 'pays@fiche-fix01.test', 'Admin Pays', 'active', FALSE),
       ($8, $6, 'READ-FIX-A', 'Reader', 'A', 'r@fiche-fix01.test', 'Lecteur fiches', 'active', FALSE),
       ($9, $6, 'PAR-FIX-A', 'Parent', 'A', 'p@fiche-fix01.test', 'Parent', 'active', FALSE)`,
    [USER_A, USER_B, USER_TEACHER, USER_SUPER, USER_PAYS, schoolAId, schoolBId, USER_READER, USER_PARENT],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $4, 'SCHOOL_ADMIN', 'active'),
       ($2, $5, 'SCHOOL_ADMIN', 'active'),
       ($3, $4, 'TEACHER', 'active'),
       ($6, NULL, 'SUPER_ADMIN', 'active'),
       ($7, NULL, 'COUNTRY_ADMIN', 'active'),
       ($8, $4, 'LECTEUR_FICHES', 'active'),
       ($9, $4, 'PARENT', 'active')`,
    [USER_A, USER_B, USER_TEACHER, schoolAId, schoolBId, USER_SUPER, USER_PAYS, USER_READER, USER_PARENT],
  );
  const readerRole = await pool.query(
    `INSERT INTO establishment_roles (role_code, role_name, scope, status, school_assignable)
     VALUES ('LECTEUR_FICHES', 'Lecteur fiches', 'school', 'active', TRUE)
     RETURNING id`,
  );
  await pool.query(
    `INSERT INTO establishment_role_permissions (role_id, permission)
     VALUES ($1, 'Élèves:READ')`,
    [readerRole.rows[0].id],
  );
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, status, updated_by
     ) VALUES ('LECTEUR_FICHES', 'global', 'students', FALSE, TRUE, FALSE, FALSE, 'active', 'fiche-fix01')`,
  );
  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolAId],
  );
  const classA = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, 'Classe fixture', 'active') RETURNING id, class_code`,
    [schoolAId, yearA.rows[0].id, CLASS_A],
  );

  const insertedA = await pool.query(
    `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
     VALUES ($1, $2, 'CD-LAC-EL-26-901', 'Eleve', 'A', 'active')
     RETURNING student_code`,
    [STUDENT_A, schoolAId],
  );
  const insertedB = await pool.query(
    `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
     VALUES ($1, $2, 'BI-BUJ-EL-26-901', 'Eleve', 'B', 'active')
     RETURNING student_code`,
    [STUDENT_B, schoolBId],
  );
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [schoolAId, STUDENT_A, classA.rows[0].id, yearA.rows[0].id],
  );
  const contact = await pool.query(
    `INSERT INTO contacts (school_id, country_id, first_name, last_name, contact_type, status, user_id)
     VALUES ($1, $2, 'Parent', 'A', 'parent', 'active', $3) RETURNING id`,
    [schoolAId, cd.id, USER_PARENT],
  );
  await pool.query(
    `INSERT INTO contact_relations (school_id, country_id, relation_type, contact_id, student_id, status)
     VALUES ($1, $2, 'parent_student', $3, $4, 'active')`,
    [schoolAId, cd.id, contact.rows[0].id, STUDENT_A],
  );
  return {
    codeA: insertedA.rows[0].student_code,
    codeB: insertedB.rows[0].student_code,
    classCode: classA.rows[0].class_code,
    schoolAId,
  };
}

async function notesOf(pool, studentCode) {
  const row = await pool.query(
    `SELECT administrative_notes, first_name FROM students WHERE student_code = $1`,
    [studentCode],
  );
  return row.rows[0] ?? null;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentAdministrativeNotes.http.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: isolatedUrl });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }

  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const repo = createPostgresRepository(isolatedUrl);
  const tokens = new TokenService({ secret: JWT_SECRET });
  const mint = (payload) => tokens.createAccessToken({ mustChangePassword: false, ...payload });
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;

  try {
    await repo.init();
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const { codeA, codeB, classCode, schoolAId } = await seed(pool);
    assert.notEqual(codeA, codeB);

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: isolatedUrl,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    await waitForHealth(child, stderrRef);

    const tokenA = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: ["Élèves:READ", "Élèves:UPDATE", "Gérer élèves", "Voir élèves"],
    });
    const tokenAReconnect = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: ["Élèves:READ", "Élèves:UPDATE", "Gérer élèves", "Voir élèves"],
    });
    const tokenB = mint({
      sub: USER_B,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: ["Élèves:READ", "Élèves:UPDATE", "Gérer élèves", "Voir élèves"],
    });
    const tokenTeacher = mint({
      sub: USER_TEACHER,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: ["Élèves:READ", "Voir élèves", "Modifier notes"],
      assignments: [{ classCode, status: "active" }],
      classCodes: [classCode],
    });
    const tokenReader = mint({
      sub: USER_READER,
      role: "Lecteur fiches",
      roleKeys: ["LECTEUR_FICHES"],
      schoolCode: LEFTOVER_A,
      permissions: ["Élèves:READ"],
    });
    const tokenParent = mint({
      sub: USER_PARENT,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LEFTOVER_A,
      schoolId: schoolAId,
      permissions: ["Élèves:READ", "Voir enfant"],
      studentIds: [STUDENT_A, codeA],
    });
    const tokenSuper = mint({
      sub: USER_SUPER,
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: LOGIN_A,
      permissions: ["ALL_PRIVILEGES", "Élèves:READ", "Élèves:UPDATE"],
    });
    const tokenPays = mint({
      sub: USER_PAYS,
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      schoolCode: LOGIN_A,
      countryCode: "CD",
      permissions: ["COUNTRY_PRIVILEGES", "ALL_PRIVILEGES", "Élèves:UPDATE"],
    });

    const before = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenA });
    assert.equal(before.status, 200, JSON.stringify(before.data));
    assert.equal(before.data.administrativeNotes, null);
    const token = before.data.updatedAt;
    assert.ok(token);

    const created = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: `  ${NOTE_A}  `, expectedUpdatedAt: token },
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.administrativeNotes, NOTE_A);
    const written = await notesOf(pool, codeA);
    assert.equal(written.administrative_notes, NOTE_A);

    const reloaded = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenA });
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.data.administrativeNotes, NOTE_A);

    const reconnected = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenAReconnect });
    assert.equal(reconnected.status, 200);
    assert.equal(reconnected.data.administrativeNotes, NOTE_A);

    const second = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: NOTE_B, expectedUpdatedAt: created.data.updatedAt },
    });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.administrativeNotes, NOTE_B);
    assert.equal((await notesOf(pool, codeA)).administrative_notes, NOTE_B);
    const afterSecondGet = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenA });
    assert.equal(afterSecondGet.data.administrativeNotes, NOTE_B);

    const cleared = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: "   ", expectedUpdatedAt: second.data.updatedAt },
    });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
    assert.equal(cleared.data.administrativeNotes, null);
    assert.equal((await notesOf(pool, codeA)).administrative_notes, null);
    const afterClearGet = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenA });
    assert.equal(afterClearGet.data.administrativeNotes, null);

    const restored = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: NOTE_A, expectedUpdatedAt: cleared.data.updatedAt },
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.data));

    const conflict = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: "NOTE-FIXTURE-LOST", expectedUpdatedAt: cleared.data.updatedAt },
    });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
    assert.equal((await notesOf(pool, codeA)).administrative_notes, NOTE_A);

    const teacher = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenTeacher,
      body: { administrativeNotes: "NOTE-FIXTURE-DENIED", expectedUpdatedAt: restored.data.updatedAt },
    });
    assert.equal(teacher.status, 403, JSON.stringify(teacher.data));
    assert.equal((await notesOf(pool, codeA)).administrative_notes, NOTE_A);

    function assertNotesConcealed(response, secret) {
      const body = JSON.stringify(response.data ?? null);
      assert.equal(body.includes(secret), false, body);
      assert.equal(body.includes("administrativeNotes"), false, body);
    }

    const teacherRead = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenTeacher });
    assert.equal(teacherRead.status, 200, JSON.stringify(teacherRead.data));
    assert.equal(teacherRead.data.firstName, "Eleve");
    assertNotesConcealed(teacherRead, NOTE_A);
    const readerRead = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenReader });
    assert.equal(readerRead.status, 200, JSON.stringify(readerRead.data));
    assert.equal(readerRead.data.firstName, "Eleve");
    assertNotesConcealed(readerRead, NOTE_A);
    const readerWrite = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenReader,
      body: { administrativeNotes: "NOTE-FIXTURE-READER", expectedUpdatedAt: restored.data.updatedAt },
    });
    assert.equal(readerWrite.status, 403, JSON.stringify(readerWrite.data));
    assertNotesConcealed(readerWrite, NOTE_A);
    const parentRead = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenParent });
    assert.equal(parentRead.status, 200, JSON.stringify(parentRead.data));
    assert.equal(parentRead.data.firstName, "Eleve");
    assertNotesConcealed(parentRead, NOTE_A);
    const parentWrite = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenParent,
      body: { administrativeNotes: "NOTE-FIXTURE-PARENT", expectedUpdatedAt: restored.data.updatedAt },
    });
    assert.equal(parentWrite.status, 403, JSON.stringify(parentWrite.data));
    assertNotesConcealed(parentWrite, NOTE_A);
    const roster = await request("/students", { token: tokenTeacher });
    assert.equal(roster.status, 200, JSON.stringify(roster.data));
    assertNotesConcealed(roster, NOTE_A);
    const classRoster = await request(`/classes/${encodeURIComponent(classCode)}/students`, { token: tokenTeacher });
    assert.equal(classRoster.status, 200, JSON.stringify(classRoster.data));
    assertNotesConcealed(classRoster, NOTE_A);
    assert.equal((await notesOf(pool, codeA)).administrative_notes, NOTE_A);

    const otherRead = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenB });
    assert.equal(otherRead.status, 404, JSON.stringify(otherRead.data));
    assert.equal(JSON.stringify(otherRead.data).includes(NOTE_A), false);
    const otherWrite = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenB,
      body: { administrativeNotes: "NOTE-FIXTURE-LEAK", expectedUpdatedAt: restored.data.updatedAt },
    });
    assert.equal(otherWrite.status, 404, JSON.stringify(otherWrite.data));
    assert.equal(JSON.stringify(otherWrite.data).includes(NOTE_A), false);
    assert.equal((await notesOf(pool, codeA)).administrative_notes, NOTE_A);
    assert.equal((await notesOf(pool, codeB)).administrative_notes, null);

    const beforePlatform = (await notesOf(pool, codeA)).administrative_notes;
    const superGet = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenSuper });
    assert.equal(superGet.status, 403, JSON.stringify(superGet.data));
    const superPatch = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenSuper,
      body: { administrativeNotes: "NOTE-FIXTURE-SUPER", expectedUpdatedAt: restored.data.updatedAt },
    });
    assert.equal(superPatch.status, 403, JSON.stringify(superPatch.data));
    const paysGet = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenPays });
    assert.equal(paysGet.status, 403, JSON.stringify(paysGet.data));
    const paysPatch = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenPays,
      body: { administrativeNotes: "NOTE-FIXTURE-PAYS", expectedUpdatedAt: restored.data.updatedAt },
    });
    assert.equal(paysPatch.status, 403, JSON.stringify(paysPatch.data));
    assert.equal((await notesOf(pool, codeA)).administrative_notes, beforePlatform);

    const originalName = (await notesOf(pool, codeA)).first_name;
    const atomic = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        firstName: "PrenomFix",
        administrativeNotes: "NOTE-FIXTURE-ATOMIC",
        expectedUpdatedAt: restored.data.updatedAt,
      },
    });
    assert.equal(atomic.status, 200, JSON.stringify(atomic.data));
    assert.equal(atomic.data.firstName, "PrenomFix");
    assert.equal(atomic.data.administrativeNotes, "NOTE-FIXTURE-ATOMIC");
    const atomicSql = await notesOf(pool, codeA);
    assert.equal(atomicSql.first_name, "PrenomFix");
    assert.equal(atomicSql.administrative_notes, "NOTE-FIXTURE-ATOMIC");

    const rejectedHtml = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        firstName: "NeDoitPasPasser",
        administrativeNotes: "<b>html</b>",
        expectedUpdatedAt: atomic.data.updatedAt,
      },
    });
    assert.equal(rejectedHtml.status, 400, JSON.stringify(rejectedHtml.data));
    const afterHtml = await notesOf(pool, codeA);
    assert.equal(afterHtml.first_name, "PrenomFix");
    assert.equal(afterHtml.administrative_notes, "NOTE-FIXTURE-ATOMIC");

    const identityOnly = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { lastName: "Famille", expectedUpdatedAt: atomic.data.updatedAt },
    });
    assert.equal(identityOnly.status, 200, JSON.stringify(identityOnly.data));
    assert.equal(identityOnly.data.administrativeNotes, "NOTE-FIXTURE-ATOMIC");
    assert.equal(identityOnly.data.lastName, "Famille");

    const notesOnly = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        administrativeNotes: NOTE_A,
        expectedUpdatedAt: identityOnly.data.updatedAt,
      },
    });
    assert.equal(notesOnly.status, 200, JSON.stringify(notesOnly.data));
    assert.equal(notesOnly.data.firstName, "PrenomFix");
    assert.equal(notesOnly.data.administrativeNotes, NOTE_A);
    assert.notEqual(originalName, "PrenomFix");

    const missing = await request("/students/CD-LAC-EL-26-999", {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: "absent", expectedUpdatedAt: notesOnly.data.updatedAt },
    });
    assert.equal(missing.status, 404);

    const tooLong = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        administrativeNotes: "x".repeat(2001),
        expectedUpdatedAt: notesOnly.data.updatedAt,
      },
    });
    assert.equal(tooLong.status, 400, JSON.stringify(tooLong.data));
    assert.equal((await notesOf(pool, codeA)).administrative_notes, NOTE_A);

    const channel = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        administrativeNotes: NOTE_A,
        preferredContactChannel: "SMS",
        expectedUpdatedAt: notesOnly.data.updatedAt,
      },
    });
    assert.equal(channel.status, 400, JSON.stringify(channel.data));

    const threeLines = "Ligne alpha — élève\nDeuxième ligne\nTroisième";
    const spaced = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        administrativeNotes: "  Ligne alpha — élève   \nDeuxième   ligne\n  Troisième  ",
        expectedUpdatedAt: notesOnly.data.updatedAt,
      },
    });
    assert.equal(spaced.status, 200, JSON.stringify(spaced.data));
    assert.equal(spaced.data.administrativeNotes, "Ligne alpha — élève\nDeuxième ligne\nTroisième");
    const paragraphs = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        administrativeNotes: "Para un\r\n\r\n\r\nPara deux",
        expectedUpdatedAt: spaced.data.updatedAt,
      },
    });
    assert.equal(paragraphs.status, 200, JSON.stringify(paragraphs.data));
    assert.equal(paragraphs.data.administrativeNotes, "Para un\n\nPara deux");
    assert.equal((await notesOf(pool, codeA)).administrative_notes, "Para un\n\nPara deux");
    const reloadedLines = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenA });
    assert.equal(reloadedLines.status, 200);
    assert.equal(reloadedLines.data.administrativeNotes, "Para un\n\nPara deux");
    const teacherLines = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenTeacher });
    assert.equal(teacherLines.status, 200, JSON.stringify(teacherLines.data));
    assertNotesConcealed(teacherLines, "Para un");
    assertNotesConcealed(teacherLines, "Para deux");
    const maxNotes = `${"é".repeat(1998)}\nX`;
    assert.equal(maxNotes.length, 2000);
    const maxSaved = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: maxNotes, expectedUpdatedAt: paragraphs.data.updatedAt },
    });
    assert.equal(maxSaved.status, 200, JSON.stringify(maxSaved.data));
    assert.equal(maxSaved.data.administrativeNotes, maxNotes);
    const maxReload = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenA });
    assert.equal(maxReload.data.administrativeNotes, maxNotes);
    const tooLongLines = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: {
        administrativeNotes: `${"é".repeat(1999)}\nX`,
        expectedUpdatedAt: maxSaved.data.updatedAt,
      },
    });
    assert.equal(tooLongLines.status, 400, JSON.stringify(tooLongLines.data));
    assert.equal((await notesOf(pool, codeA)).administrative_notes, maxNotes);
    const clearedLines = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: " \n \n ", expectedUpdatedAt: maxSaved.data.updatedAt },
    });
    assert.equal(clearedLines.status, 200, JSON.stringify(clearedLines.data));
    assert.equal(clearedLines.data.administrativeNotes, null);
    assert.equal((await notesOf(pool, codeA)).administrative_notes, null);
    const afterClearReload = await request(`/students/${encodeURIComponent(codeA)}`, { token: tokenA });
    assert.equal(afterClearReload.data.administrativeNotes, null);
    const restoredLines = await request(`/students/${encodeURIComponent(codeA)}`, {
      method: "PATCH",
      token: tokenA,
      body: { administrativeNotes: threeLines, expectedUpdatedAt: clearedLines.data.updatedAt },
    });
    assert.equal(restoredLines.status, 200, JSON.stringify(restoredLines.data));
    assert.equal(restoredLines.data.administrativeNotes, threeLines);

    const audits = await pool.query(
      `SELECT coalesce(new_value::text, '') || coalesce(old_value::text, '') AS payload
         FROM audit_logs
        WHERE action = 'update_student'`,
    );
    assert.ok(audits.rowCount > 0);
    for (const row of audits.rows) {
      assert.equal(String(row.payload).includes(NOTE_A), false);
      assert.equal(String(row.payload).includes(NOTE_B), false);
      assert.equal(String(row.payload).includes("NOTE-FIXTURE-ATOMIC"), false);
      assert.equal(String(row.payload).includes("Ligne alpha"), false);
      assert.equal(String(row.payload).includes("Para un"), false);
    }

    console.log("studentAdministrativeNotes.http.pg.test.js: OK");
  } finally {
    await stopChild(child);
    try {
      await pool.query("DROP SCHEMA public CASCADE");
      await pool.query("CREATE SCHEMA public");
    } catch {
      /* la base isolée est jetable */
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
