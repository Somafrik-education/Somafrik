"use strict";

/**
 * P0 Enrollment — leftover JWT ≠ login_code.
 * ENR-01…ENR-06 sont des invariants, pas des findings.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_ENROLL_GP_IT_DATABASE ?? "somafrik_enroll_tenant_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_ENROLL_GP_HTTP_PORT ?? 19885);
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
  await pool.query(`UPDATE users SET profile_payload = jsonb_build_object('countryCode', 'CD') WHERE id = $1`, [
    USER_PAYS_CD,
  ]);
  await pool.query(
    `INSERT INTO students (id, school_id, student_code, first_name, last_name, status)
     VALUES ($1, $3, 'STU-A-001', 'Eleve', 'A', 'active'), ($2, $4, 'STU-B-001', 'Eleve', 'B', 'active')`,
    [STUDENT_A, STUDENT_B, schoolAId, schoolBId],
  );
  const classA = await pool.query(`SELECT id FROM classes WHERE class_code = $1`, [CLASS_A]);
  const classB = await pool.query(`SELECT id FROM classes WHERE class_code = $1`, [CLASS_B]);
  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $2, $3, $4, 'active'), ($5, $6, $7, $8, 'active')`,
    [schoolAId, STUDENT_A, classA.rows[0].id, yearA.rows[0].id, schoolBId, STUDENT_B, classB.rows[0].id, yearB.rows[0].id],
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

    const isStudentA = (row) => String(row.lastName ?? "") === "A";
    const isStudentB = (row) => String(row.lastName ?? "") === "B";

    const getA = await request("/students", { token: tokenA });
    assert.equal(getA.status, 200, `ENR GET A: ${JSON.stringify(getA.data)}`);
    const studentsA = unwrapList(getA.data);
    assert.ok(studentsA.some(isStudentA), "P0-1: user A voit A");
    assert.equal(studentsA.some(isStudentB), false, "P0-1: A ne voit pas B");
    assert.ok(
      studentsA.every((row) => row.schoolCode === LOGIN_A),
      `ENR-01 projection login_code: ${studentsA.map((row) => row.schoolCode).join(",")}`,
    );

    const getForgedJwt = await request("/students", { token: tokenForgedB });
    const forged = unwrapList(getForgedJwt.data);
    assert.ok(
      getForgedJwt.status === 403 || !forged.some(isStudentB),
      `ENR-02 JWT leftover B depuis A: ${getForgedJwt.status}`,
    );
    assert.equal(forged.some(isStudentB), false, "ENR-02: jamais B");

    const getHeader = await request("/students", {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    assert.equal(unwrapList(getHeader.data).some(isStudentB), false, "header schoolCode B depuis A");

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
    assert.ok(postB.status === 403 || postB.status === 404, `ENR-03 POST classe B status=${postB.status}`);
    const countBAfter = (
      await pool.query(`SELECT count(*)::int AS c FROM students WHERE school_id = (SELECT id FROM schools WHERE school_code = $1)`, [
        LEFTOVER_B,
      ])
    ).rows[0].c;
    assert.equal(countBAfter, countBBefore, "ENR-03: 0 write B");

    const studentBBefore = await pool.query(`SELECT first_name FROM students WHERE id = $1`, [STUDENT_B]);
    const patchB = await request(`/students/${STUDENT_B}`, {
      method: "PATCH",
      token: tokenA,
      body: { firstName: "Hacked" },
    });
    const studentBAfter = await pool.query(`SELECT first_name FROM students WHERE id = $1`, [STUDENT_B]);
    assert.ok(patchB.status === 403 || patchB.status === 404, `PATCH B status=${patchB.status}`);
    assert.equal(studentBAfter.rows[0].first_name, studentBBefore.rows[0].first_name, "0 mutation B");

    const getNoSub = await request("/students", { token: tokenNoSub });
    assert.ok(getNoSub.status === 403 || getNoSub.status === 401, `ENR-04 sans sub: ${getNoSub.status}`);

    const getNoSchool = await request("/students", { token: tokenNoSchool });
    assert.ok(getNoSchool.status === 403 || getNoSchool.status === 401, `ENR-05 sans school_id: ${getNoSchool.status}`);

    await setLoginCodeTriggers(pool, false);
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    const cdId = (await pool.query(`SELECT id FROM countries WHERE iso_code = 'CD' LIMIT 1`)).rows[0].id;
    const emptySchool = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1, 'CD-2026-0099', NULL, 'SLG', 'École sans login', 'active') RETURNING id`,
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
    assert.ok(getNoLogin.status === 403 || getNoLogin.status === 401, `ENR-06 login_code vide: ${getNoLogin.status}`);

    const getB = await request("/students", { token: tokenB });
    assert.equal(getB.status, 200, `GET B: ${getB.status}`);
    assert.equal(unwrapList(getB.data).some(isStudentA), false, "B ne voit pas A");
    assert.ok(unwrapList(getB.data).every((row) => row.schoolCode === LOGIN_B));

    const getSuper = await request("/students", { token: tokenSuper });
    assert.ok(getSuper.status === 200 || getSuper.status === 400, `Superadmin: ${getSuper.status}`);

    const getPays = await request("/students", { token: tokenPaysCd });
    assert.equal(unwrapList(getPays.data).some(isStudentB), false, "Admin Pays CD jamais BI");

    const postA = await request(`/classes/${CLASS_A}/students`, {
      method: "POST",
      token: tokenA,
      body: { firstName: "Membre", lastName: "Ok" },
    });
    assert.equal(postA.status, 201, `POST classe A: ${JSON.stringify(postA.data)}`);
    assert.equal(postA.data?.student?.schoolCode, LOGIN_A);

    console.log("OK enrollmentTenant.http.pg.test.js — ENR-01…ENR-06 invariants");
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
