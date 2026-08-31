"use strict";

/**
 * Lot D — findings #437 encore signalés + SY-02 / SY-09 / SY-10.
 * Dual-identity A leftover CD-2026-0001 / login CD-LAC-26-001
 *               B leftover BI-2026-0001 / login BI-BUJ-26-001
 * Aucun assouplissement : la gate échoue si un finding est reproduit.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_D_REVALIDATION_IT_DATABASE ?? "somafrik_d_revalidation_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_D_REVALIDATION_HTTP_PORT ?? 19911);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const USER_TEACHER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const USER_TEACHER_NONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05";
const USER_PARENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa0a";
const USER_PAYS_CD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09";
const PRESENCE_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const PRESENCE_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const CLASS_A = "CLS-LAC-6A";
const CLASS_B = "CLS-BUJ-6A";
const TEACHER_CODE_A = "TCH-LAC-01";
const PERMS = ["ALL_PRIVILEGES", "Voir classes", "Classes:READ", "Élèves:READ"];
const TEACHER_PERMS = ["Présences:READ", "Présences:CREATE", "Élèves:READ", "ALL_PRIVILEGES"];

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

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function isPresenceB(row) {
  return String(row?.id) === PRESENCE_B || row?.schoolCode === LOGIN_B || row?.schoolCode === LEFTOVER_B;
}

function isPresenceA(row) {
  return String(row?.id) === PRESENCE_A || row?.schoolCode === LOGIN_A || row?.studentId === "STU-A-001";
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
     VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active') RETURNING id`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active') RETURNING id`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  await setLoginCodeTriggers(pool, true);

  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;

  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolAId],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolBId],
  );

  const classA = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème A Lac', 'active') RETURNING id`,
    [schoolAId, yearA.rows[0].id, CLASS_A],
  );
  const classB = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème A Buj', 'active') RETURNING id`,
    [schoolBId, yearB.rows[0].id, CLASS_B],
  );

  const studentA = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-A-001', 'Ada', 'A', 'active') RETURNING id`,
    [schoolAId],
  );
  const studentB = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-B-001', 'Binta', 'B', 'active') RETURNING id`,
    [schoolBId],
  );

  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $3, $5, $7, 'active'), ($2, $4, $6, $8, 'active')`,
    [
      schoolAId,
      schoolBId,
      studentA.rows[0].id,
      studentB.rows[0].id,
      classA.rows[0].id,
      classB.rows[0].id,
      yearA.rows[0].id,
      yearB.rows[0].id,
    ],
  );

  const subjectA = await pool.query(
    `INSERT INTO subjects (school_id, subject_code, name, status)
     VALUES ($1, 'SUB-LAC-MATH', 'Maths Lac', 'active') RETURNING id`,
    [schoolAId],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $6, 'ADM-A', 'Aline', 'A', 'a@drev.gp.test', 'Admin School', 'active', FALSE),
       ($2, $7, 'ADM-B', 'Binta', 'B', 'b@drev.gp.test', 'Admin School', 'active', FALSE),
       ($3, $6, 'TCH-A', 'Tana', 'A', 'ta@drev.gp.test', 'Enseignant', 'active', FALSE),
       ($4, $6, 'TCH-NONE', 'Sans', 'Aff', 'tn@drev.gp.test', 'Enseignant', 'active', FALSE),
       ($5, $6, 'PAR-A', 'Parent', 'Vide', 'pa@drev.gp.test', 'Parent', 'active', FALSE),
       ($8, NULL, 'PAYS-CD', 'Admin', 'Pays', 'pays@drev.gp.test', 'Admin Pays', 'active', FALSE)`,
    [USER_A, USER_B, USER_TEACHER_A, USER_TEACHER_NONE, USER_PARENT, schoolAId, schoolBId, USER_PAYS_CD],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $5, 'SCHOOL_ADMIN', 'active'),
       ($2, $6, 'SCHOOL_ADMIN', 'active'),
       ($3, $5, 'TEACHER', 'active'),
       ($4, $5, 'TEACHER', 'active'),
       ($7, $5, 'PARENT', 'active'),
       ($8, NULL, 'COUNTRY_ADMIN', 'active')`,
    [USER_A, USER_B, USER_TEACHER_A, USER_TEACHER_NONE, schoolAId, schoolBId, USER_PARENT, USER_PAYS_CD],
  );

  const teacherA = await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [schoolAId, USER_TEACHER_A, TEACHER_CODE_A],
  );
  await pool.query(
    `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [schoolAId, teacherA.rows[0].id, classA.rows[0].id, subjectA.rows[0].id, yearA.rows[0].id],
  );

  await pool.query(
    `INSERT INTO attendance (id, school_id, student_id, class_id, attendance_date, status)
     VALUES
       ($1, $3, $5, $7, '2026-08-31', 'present'),
       ($2, $4, $6, $8, '2026-08-31', 'present')`,
    [
      PRESENCE_A,
      PRESENCE_B,
      schoolAId,
      schoolBId,
      studentA.rows[0].id,
      studentB.rows[0].id,
      classA.rows[0].id,
      classB.rows[0].id,
    ],
  );

  return { schoolAId, schoolBId, studentAId: studentA.rows[0].id };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("dRevalidation.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;

  function mint(payload) {
    return tokens.createAccessToken({ mustChangePassword: false, ...payload });
  }

  try {
    await repo.init();
    const fixture = await seed(repo.pool);

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
      permissions: PERMS,
    });
    const tokenB = mint({
      sub: USER_B,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: PERMS,
    });
    const tokenForgedB = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: PERMS,
    });
    const tokenTeacherNone = mint({
      sub: USER_TEACHER_NONE,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: TEACHER_PERMS,
    });
    const tokenTeacherA = mint({
      sub: USER_TEACHER_A,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: TEACHER_PERMS,
    });
    const tokenParent = mint({
      sub: USER_PARENT,
      role: "Parent",
      roleKeys: ["PARENT"],
      schoolCode: LEFTOVER_A,
      permissions: TEACHER_PERMS,
      studentIds: [],
    });
    const tokenPaysCd = mint({
      sub: USER_PAYS_CD,
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      schoolCode: "*",
      countryCode: "CD",
      permissions: PERMS,
    });

    const postALeftover = await request("/presences", {
      method: "POST",
      token: tokenForgedB,
      body: {
        classCode: CLASS_A,
        teacherId: TEACHER_CODE_A,
        items: [{ studentId: "STU-A-001", date: "2026-09-10", status: "Présent", classCode: CLASS_A }],
      },
    });
    assert.ok(
      postALeftover.status === 201 || postALeftover.status === 200,
      `PR-audit POST A leftover B status=${postALeftover.status} body=${JSON.stringify(postALeftover.data)}`,
    );
    const audits = await pool.query(
      `SELECT a.action, s.school_code, s.login_code
       FROM audit_logs a
       JOIN schools s ON s.id = a.school_id
       WHERE a.action = 'upsert_attendance_batch'
       ORDER BY a.created_at DESC`,
    );
    assert.ok(audits.rowCount >= 1, "PR-audit: au moins une ligne upsert_attendance_batch");
    assert.ok(
      audits.rows.every((row) => row.login_code === LOGIN_A && row.school_code === LEFTOVER_A),
      `PR-audit: audit canonique A, jamais B: ${JSON.stringify(audits.rows)}`,
    );
    const leakedB = await pool.query(
      `SELECT count(*)::int AS c
       FROM audit_logs a
       JOIN schools s ON s.id = a.school_id
       WHERE s.school_code = $1 AND a.action = 'upsert_attendance_batch'`,
      [LEFTOVER_B],
    );
    assert.equal(leakedB.rows[0].c, 0, "PR-audit: 0 audit leftover B");

    const getTeacherNone = await request("/presences", { token: tokenTeacherNone });
    assert.ok(
      getTeacherNone.status === 200 || getTeacherNone.status === 403,
      `PR-scope enseignant status=${getTeacherNone.status}`,
    );
    const teacherNoneRows = unwrapList(getTeacherNone.data);
    assert.equal(
      teacherNoneRows.some(isPresenceA) || teacherNoneRows.some(isPresenceB),
      false,
      `PR-scope: enseignant non affecté n'élargit pas l'école: ${JSON.stringify(teacherNoneRows)}`,
    );

    const getParent = await request("/presences", { token: tokenParent });
    assert.ok(getParent.status === 200 || getParent.status === 403, `PR-scope parent status=${getParent.status}`);
    const parentRows = unwrapList(getParent.data);
    assert.equal(
      parentRows.some(isPresenceA) || parentRows.some(isPresenceB),
      false,
      `PR-scope: parent sans élève n'élargit pas l'école: ${JSON.stringify(parentRows)}`,
    );

    const studentsB = await request("/mobile-sync/l1/students", { token: tokenB });
    assert.equal(studentsB.status, 200, `SY-02 GET B students: ${JSON.stringify(studentsB.data)}`);
    const itemsB = Array.isArray(studentsB.data?.items) ? studentsB.data.items : [];
    assert.equal(
      itemsB.some((row) => String(row.studentCode ?? row.student_code ?? row.id) === "STU-A-001"),
      false,
      "SY-02 B jamais A",
    );

    await pool.query(
      `UPDATE user_roles SET status = 'revoked', revoked_at = NOW()
       WHERE user_id = $1 AND school_id = $2 AND role_key = 'TEACHER'`,
      [USER_TEACHER_A, fixture.schoolAId],
    );
    const revoked = await request("/mobile-sync/l1/students", { token: tokenTeacherA });
    assert.equal(revoked.status, 200, `SY-09 enseignant révoqué ne doit pas 403: ${JSON.stringify(revoked.data)}`);
    assert.deepEqual(revoked.data?.items ?? null, [], "SY-09 items vides");
    if (revoked.data?.scopeKind != null) {
      assert.equal(revoked.data.scopeKind, "none", "SY-09 scopeKind=none");
    }

    const pays = await request("/mobile-sync/l1/students", { token: tokenPaysCd });
    assert.ok(pays.status === 200 || pays.status === 400 || pays.status === 403, `SY-10 status=${pays.status}`);
    const paysItems = Array.isArray(pays.data?.items) ? pays.data.items : [];
    assert.equal(
      paysItems.some((row) => String(row.studentCode ?? row.student_code) === "STU-B-001"),
      false,
      "SY-10 Admin Pays CD jamais BI",
    );

    console.log("OK dRevalidation.http.pg.test.js — PR-audit / PR-scope / SY-02 / SY-09 / SY-10");
  } finally {
    await stopChild(child);
    await pool.end();
    if (typeof repo.close === "function") await repo.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
