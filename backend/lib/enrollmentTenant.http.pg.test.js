"use strict";

/**
 * Enrollment tenant — leftover JWT ≠ login_code du même tenant.
 * Dual-identity A/B : ENR-01…ENR-06 sont des invariants (pas des findings).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_ENROLLMENT_GP_IT_DATABASE ?? "somafrik_enrollment_tenant_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_ENROLLMENT_HTTP_PORT ?? 19886);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";

const USER_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";
const USER_NO_SCHOOL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb03";
const USER_NO_LOGIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb04";
const USER_SUPER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05";
const USER_PAYS_CD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb06";
const STUDENT_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11";
const STUDENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb12";
const CLASS_A = "CLS-LAC-6A";
const CLASS_B = "CLS-BUJ-6A";

const PERMS = ["ALL_PRIVILEGES"];

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
  if (data && Array.isArray(data.rows)) return data.rows;
  return [];
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
     VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active')
     RETURNING id, school_code, login_code`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active')
     RETURNING id, school_code, login_code`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  await setLoginCodeTriggers(pool, true);
  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;
  assert.notEqual(schoolA.rows[0].school_code, schoolA.rows[0].login_code);
  assert.notEqual(schoolB.rows[0].school_code, schoolB.rows[0].login_code);

  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id`,
    [schoolAId],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, is_current, status)
     VALUES ($1, '2026-2027', TRUE, 'open') RETURNING id`,
    [schoolBId],
  );
  await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème A Lac', 'active'), ($4, $5, $6, '6ème A Buj', 'active')`,
    [schoolAId, yearA.rows[0].id, CLASS_A, schoolBId, yearB.rows[0].id, CLASS_B],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $6, 'ADM-A', 'Aline', 'A', 'a@enroll.gp.test', 'Admin School', 'active', FALSE),
       ($2, $7, 'ADM-B', 'Binta', 'B', 'b@enroll.gp.test', 'Admin School', 'active', FALSE),
       ($3, NULL, 'ADM-NS', 'Sans', 'Ecole', 'ns@enroll.gp.test', 'Admin School', 'active', FALSE),
       ($4, NULL, 'SUPER', 'Super', 'Admin', 'super@enroll.gp.test', 'Super Administrateur Somafrik', 'active', FALSE),
       ($5, NULL, 'PAYS-CD', 'Admin', 'Pays', 'pays@enroll.gp.test', 'Admin Pays', 'active', FALSE)`,
    [USER_A, USER_B, USER_NO_SCHOOL, USER_SUPER, USER_PAYS_CD, schoolAId, schoolBId],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $5, 'SCHOOL_ADMIN', 'active'),
       ($2, $6, 'SCHOOL_ADMIN', 'active'),
       ($3, NULL, 'SUPER_ADMIN', 'active'),
       ($4, NULL, 'COUNTRY_ADMIN', 'active')`,
    [USER_A, USER_B, USER_SUPER, USER_PAYS_CD, schoolAId, schoolBId],
  );
  await pool.query(
    `UPDATE users SET profile_payload = jsonb_build_object('countryCode', 'CD') WHERE id = $1`,
    [USER_PAYS_CD],
  );

  await pool.query(
    `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
     VALUES
       ($1, $3, 'STU-A-001', 'Eleve', 'A', 'active'),
       ($2, $4, 'STU-B-001', 'Eleve', 'B', 'active')`,
    [STUDENT_A, STUDENT_B, schoolAId, schoolBId],
  );
  const classA = await pool.query(`SELECT id FROM classes WHERE class_code = $1`, [CLASS_A]);
  const classB = await pool.query(`SELECT id FROM classes WHERE class_code = $1`, [CLASS_B]);
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'active'), ($5, $6, $7, $8, 'active')`,
    [
      schoolAId,
      STUDENT_A,
      classA.rows[0].id,
      yearA.rows[0].id,
      schoolBId,
      STUDENT_B,
      classB.rows[0].id,
      yearB.rows[0].id,
    ],
  );

  return { schoolAId, schoolBId };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("enrollmentTenant.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
    await seed(repo.pool);

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
    const tokenNoSub = mint({
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: PERMS,
    });
    const tokenNoSchool = mint({
      sub: USER_NO_SCHOOL,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: PERMS,
    });
    const tokenSuper = mint({
      sub: USER_SUPER,
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: "*",
      permissions: PERMS,
    });
    const tokenPaysCd = mint({
      sub: USER_PAYS_CD,
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      schoolCode: "*",
      countryCode: "CD",
      permissions: PERMS,
    });

    const isStudentA = (row) =>
      String(row.lastName ?? "") === "A" || String(row.studentCode ?? "").startsWith("STU-A");
    const isStudentB = (row) =>
      String(row.lastName ?? "") === "B" || String(row.studentCode ?? "").startsWith("STU-B");

    const getA = await request("/students", { token: tokenA });
    const studentsA = unwrapList(getA.data);
    assert.equal(getA.status, 200, `P0-1 GET A status=${getA.status}`);
    assert.ok(studentsA.some(isStudentA), "P0-1: user A doit voir A");
    assert.ok(!studentsA.some(isStudentB), "P0-1: A ne doit pas voir B");
    assert.ok(
      studentsA.every((row) => row.schoolCode === LOGIN_A),
      `ENR-01 projection schoolCode=${studentsA.map((row) => row.schoolCode).join(",") || "vide"} (désiré ${LOGIN_A})`,
    );

    const getForgedJwt = await request("/students", { token: tokenForgedB });
    const forged = unwrapList(getForgedJwt.data);
    assert.ok(
      getForgedJwt.status === 200 && forged.some(isStudentA) && !forged.some(isStudentB),
      `ENR-02 JWT leftover B depuis user A ne doit jamais lister B (status=${getForgedJwt.status})`,
    );
    assert.ok(
      forged.every((row) => row.schoolCode === LOGIN_A),
      "ENR-02 projection membership A",
    );

    const getHeader = await request("/students", {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    assert.ok(!unwrapList(getHeader.data).some(isStudentB), "P0-4 header schoolCode B depuis A");

    const countBBefore = (
      await pool.query(`SELECT count(*)::int AS c FROM students WHERE school_id = (SELECT id FROM schools WHERE school_code = $1)`, [
        LEFTOVER_B,
      ])
    ).rows[0].c;
    const postB = await request(`/classes/${CLASS_B}/students`, {
      method: "POST",
      token: tokenA,
      body: { firstName: "Intrus", lastName: "B", schoolCode: LOGIN_B },
    });
    const countBAfter = (
      await pool.query(`SELECT count(*)::int AS c FROM students WHERE school_id = (SELECT id FROM schools WHERE school_code = $1)`, [
        LEFTOVER_B,
      ])
    ).rows[0].c;
    assert.ok(postB.status === 403 || postB.status === 404, `ENR-03 POST classe B status=${postB.status}`);
    assert.equal(countBAfter, countBBefore, "ENR-03 0 write B");

    const studentBBefore = await pool.query(`SELECT first_name FROM students WHERE id = $1`, [STUDENT_B]);
    const patchB = await request(`/students/STU-B-001`, {
      method: "PATCH",
      token: tokenA,
      body: { firstName: "Hacked" },
    });
    const studentBAfter = await pool.query(`SELECT first_name FROM students WHERE id = $1`, [STUDENT_B]);
    assert.ok(patchB.status === 403 || patchB.status === 404, `P0-8 PATCH B status=${patchB.status}`);
    assert.equal(studentBAfter.rows[0].first_name, studentBBefore.rows[0].first_name, "P0-8 0 mutation B");

    const leftoverAuditOnB = async (action, entityId) => {
      const rows = await pool.query(
        `SELECT a.action, s.school_code, s.login_code
         FROM audit_logs a
         JOIN schools s ON s.id = a.school_id
         WHERE a.action = $1 AND a.entity_id::text = $2
         ORDER BY a.created_at DESC`,
        [action, entityId],
      );
      return rows.rows;
    };

    const postALeftover = await request(`/classes/${CLASS_A}/students`, {
      method: "POST",
      token: tokenForgedB,
      body: { firstName: "Nouveau", lastName: "AuditA", gender: "Féminin", birthDate: "2012-04-12" },
    });
    assert.equal(postALeftover.status, 201, `ENR-07 POST leftover B status=${postALeftover.status}`);
    const enrolledCode = String(postALeftover.data?.student?.studentCode ?? "").trim();
    assert.ok(enrolledCode, "ENR-07 studentCode enroll A");
    const enrollAudits = await leftoverAuditOnB("enroll_student", enrolledCode);
    assert.equal(enrollAudits.length, 1, "ENR-07 une ligne audit enroll");
    assert.equal(enrollAudits[0].login_code, LOGIN_A, "ENR-07 enroll audit = membership A");
    assert.equal(enrollAudits[0].school_code, LEFTOVER_A);
    assert.notEqual(enrollAudits[0].school_code, LEFTOVER_B, "ENR-07 enroll jamais leftover B");

    const getEnrolled = await request(`/students/${enrolledCode}`, { token: tokenForgedB });
    assert.equal(getEnrolled.status, 200, `ENR-07 GET enrolled leftover B status=${getEnrolled.status}`);
    const patchALeftover = await request(`/students/${enrolledCode}`, {
      method: "PATCH",
      token: tokenForgedB,
      body: {
        firstName: "Nouveau2",
        expectedUpdatedAt: getEnrolled.data?.updatedAt,
      },
    });
    assert.equal(patchALeftover.status, 200, `ENR-07 PATCH leftover B status=${patchALeftover.status}`);
    const patchAudits = await leftoverAuditOnB("update_student", enrolledCode);
    assert.equal(patchAudits.length, 1, "ENR-07 une ligne audit patch");
    assert.equal(patchAudits[0].login_code, LOGIN_A, "ENR-07 patch audit = membership A");
    assert.notEqual(patchAudits[0].school_code, LEFTOVER_B, "ENR-07 patch jamais leftover B");

    const deleteALeftover = await request(`/students/${enrolledCode}`, {
      method: "DELETE",
      token: tokenForgedB,
    });
    assert.ok(
      deleteALeftover.status === 200 || deleteALeftover.status === 204,
      `ENR-07 DELETE leftover B status=${deleteALeftover.status}`,
    );
    const deleteAudits = await leftoverAuditOnB("archive_student", enrolledCode);
    assert.equal(deleteAudits.length, 1, "ENR-07 une ligne audit archive");
    assert.equal(deleteAudits[0].login_code, LOGIN_A, "ENR-07 archive audit = membership A");
    assert.notEqual(deleteAudits[0].school_code, LEFTOVER_B, "ENR-07 archive jamais leftover B");

    const leakedB = await pool.query(
      `SELECT count(*)::int AS c
       FROM audit_logs a
       JOIN schools s ON s.id = a.school_id
       WHERE s.school_code = $1
         AND a.action IN ('enroll_student', 'update_student', 'archive_student')`,
      [LEFTOVER_B],
    );
    assert.equal(leakedB.rows[0].c, 0, "ENR-07 0 audit Enrollment sur leftover B");

    const getNoSub = await request("/students", { token: tokenNoSub });
    assert.ok(getNoSub.status === 403 || getNoSub.status === 401, `ENR-04 sans sub status=${getNoSub.status}`);

    const getNoSchool = await request("/students", { token: tokenNoSchool });
    assert.ok(
      getNoSchool.status === 403 || getNoSchool.status === 401,
      `ENR-05 sans school_id status=${getNoSchool.status}`,
    );

    await setLoginCodeTriggers(pool, false);
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const cdId = (await pool.query(`SELECT id FROM countries WHERE iso_code = 'CD' LIMIT 1`)).rows[0].id;
    const emptySchool = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1, 'CD-2026-0099', NULL, 'SLG', 'École sans login', 'active')
       RETURNING id`,
      [cdId],
    );
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'ADM-NL', 'Sans', 'Login', 'nl@enroll.gp.test', 'Admin School', 'active', FALSE)`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );
    const tokenNoLogin = mint({
      sub: USER_NO_LOGIN,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "CD-2026-0099",
      permissions: PERMS,
    });
    const getNoLogin = await request("/students", { token: tokenNoLogin });
    assert.ok(
      getNoLogin.status === 403 || getNoLogin.status === 401,
      `ENR-06 login_code vide status=${getNoLogin.status}`,
    );

    const getB = await request("/students", { token: tokenB });
    assert.equal(getB.status, 200, `P0-11 GET B status=${getB.status}`);
    assert.ok(!unwrapList(getB.data).some(isStudentA), "P0-11 jamais A");
    assert.ok(
      unwrapList(getB.data).every((row) => row.schoolCode === LOGIN_B),
      "P0-11 projection login_code B",
    );

    const getSuper = await request("/students", { token: tokenSuper });
    assert.equal(
      getSuper.status,
      403,
      `P0-9 Superadmin GET /students = donnée personnelle établissement (#503) status=${getSuper.status} ${JSON.stringify(getSuper.data)}`,
    );
    assert.ok(
      getSuper.data?.code === "PLATFORM_PERSONAL_DATA_DENIED" || getSuper.data?.code === "PERMISSION_DENIED",
      `P0-9 Superadmin code deny: ${JSON.stringify(getSuper.data)}`,
    );

    const getPays = await request("/students", { token: tokenPaysCd });
    assert.equal(
      getPays.status,
      403,
      `P0-10 Admin Pays GET /students = donnée personnelle (#503) status=${getPays.status} ${JSON.stringify(getPays.data)}`,
    );

    console.log("OK enrollmentTenant.http.pg.test.js — ENR-01…ENR-07 invariants dual-identity");
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
