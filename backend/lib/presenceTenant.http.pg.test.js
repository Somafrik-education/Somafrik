"use strict";

/**
 * GP-015 — leftover JWT ≠ login_code du même tenant.
 * Dual-identity A/B + fail-closed + Admin Pays borné au pays.
 * GET/POST /api/presences uniquement.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_PRESENCE_TENANT_IT_DATABASE ?? "somafrik_presence_tenant_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_PRESENCE_TENANT_HTTP_PORT ?? 19897);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_A2 = "CD-2026-0002";
const LOGIN_A2 = "CD-LAC-26-002";
const LEFTOVER_NO_LOGIN = "CD-2026-0099";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const USER_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const USER_TEACHER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const USER_NO_SCHOOL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06";
const USER_NO_LOGIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07";
const USER_SUPER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa08";
const USER_PAYS_CD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09";
const PRESENCE_A = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const PRESENCE_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const PRESENCE_A2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";
const CLASS_B = "CLS-BUJ-6A";
const TEACHER_CODE_B = "TCH-BUJ-01";
const PERMS = ["ALL_PRIVILEGES"];
const TEACHER_PERMS = ["Présences:READ", "Présences:CREATE", "ALL_PRIVILEGES"];

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
  const schoolA2 = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'LC2', 'Lycée Lac 2', 'active') RETURNING id`,
    [cd.id, LEFTOVER_A2, LOGIN_A2],
  );
  await setLoginCodeTriggers(pool, true);

  const schoolAId = schoolA.rows[0].id;
  const schoolBId = schoolB.rows[0].id;
  const schoolA2Id = schoolA2.rows[0].id;

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
  const yearA2 = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolA2Id],
  );

  const classA = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-LAC-6A', '6ème A Lac', 'active') RETURNING id`,
    [schoolAId, yearA.rows[0].id],
  );
  const classB = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, $3, '6ème A Buj', 'active') RETURNING id`,
    [schoolBId, yearB.rows[0].id, CLASS_B],
  );
  const classA2 = await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $2, 'CLS-LAC-6B', '6ème B Lac2', 'active') RETURNING id`,
    [schoolA2Id, yearA2.rows[0].id],
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
  const studentA2 = await pool.query(
    `INSERT INTO students (school_id, student_code, first_name, last_name, status)
     VALUES ($1, 'STU-A2-001', 'Awa', 'A2', 'active') RETURNING id`,
    [schoolA2Id],
  );

  await pool.query(
    `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
     VALUES ($1, $4, $7, $10, 'active'), ($2, $5, $8, $11, 'active'), ($3, $6, $9, $12, 'active')`,
    [
      schoolAId,
      schoolBId,
      schoolA2Id,
      studentA.rows[0].id,
      studentB.rows[0].id,
      studentA2.rows[0].id,
      classA.rows[0].id,
      classB.rows[0].id,
      classA2.rows[0].id,
      yearA.rows[0].id,
      yearB.rows[0].id,
      yearA2.rows[0].id,
    ],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $7, 'ADM-A', 'Aline', 'A', 'a@presence.gp.test', 'Admin School', 'active', FALSE),
       ($2, $8, 'ADM-B', 'Binta', 'B', 'b@presence.gp.test', 'Admin School', 'active', FALSE),
       ($3, $9, 'ADM-A2', 'Awa', 'A2', 'a2@presence.gp.test', 'Admin School', 'active', FALSE),
       ($4, $7, 'TCH-A', 'Tana', 'A', 'ta@presence.gp.test', 'Enseignant', 'active', FALSE),
       ($5, NULL, 'ADM-NS', 'Sans', 'Ecole', 'ns@presence.gp.test', 'Admin School', 'active', FALSE),
       ($6, NULL, 'SUPER', 'Super', 'Admin', 'super@presence.gp.test', 'Super Administrateur Somafrik', 'active', FALSE),
       ($10, NULL, 'PAYS-CD', 'Admin', 'Pays', 'pays@presence.gp.test', 'Admin Pays', 'active', FALSE)`,
    [USER_A, USER_B, USER_A2, USER_TEACHER_A, USER_NO_SCHOOL, USER_SUPER, schoolAId, schoolBId, schoolA2Id, USER_PAYS_CD],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $5, 'SCHOOL_ADMIN', 'active'),
       ($2, $6, 'SCHOOL_ADMIN', 'active'),
       ($3, $7, 'SCHOOL_ADMIN', 'active'),
       ($4, $5, 'TEACHER', 'active'),
       ($8, NULL, 'SUPER_ADMIN', 'active'),
       ($9, NULL, 'COUNTRY_ADMIN', 'active')`,
    [USER_A, USER_B, USER_A2, USER_TEACHER_A, schoolAId, schoolBId, schoolA2Id, USER_SUPER, USER_PAYS_CD],
  );

  await pool.query(
    `INSERT INTO teachers (school_id, user_id, teacher_code, status)
     VALUES ($1, $3, 'TCH-LAC-01', 'active'), ($2, NULL, $4, 'active')`,
    [schoolAId, schoolBId, USER_TEACHER_A, TEACHER_CODE_B],
  );

  await pool.query(
    `INSERT INTO attendance (id, school_id, student_id, class_id, attendance_date, status)
     VALUES
       ($1, $4, $7, $10, '2026-08-31', 'present'),
       ($2, $5, $8, $11, '2026-08-31', 'present'),
       ($3, $6, $9, $12, '2026-08-31', 'present')`,
    [
      PRESENCE_A,
      PRESENCE_B,
      PRESENCE_A2,
      schoolAId,
      schoolBId,
      schoolA2Id,
      studentA.rows[0].id,
      studentB.rows[0].id,
      studentA2.rows[0].id,
      classA.rows[0].id,
      classB.rows[0].id,
      classA2.rows[0].id,
    ],
  );

  return { schoolAId, schoolBId, schoolA2Id };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("presenceTenant.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
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

    await pool.query(`
      ALTER TABLE schools ALTER COLUMN login_code DROP NOT NULL;
      ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_login_code_format_check;
    `);
    await setLoginCodeTriggers(pool, false);
    const cdId = (await pool.query(`SELECT id FROM countries WHERE iso_code = 'CD' LIMIT 1`)).rows[0].id;
    const emptySchool = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
       VALUES ($1, $2, NULL, 'SLG', 'École sans login', 'active') RETURNING id, login_code`,
      [cdId, LEFTOVER_NO_LOGIN],
    );
    assert.equal(emptySchool.rows[0].login_code, null, "PR-08 fixture login_code vide");
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'ADM-NL', 'Sans', 'Login', 'nl@presence.gp.test', 'Admin School', 'active', FALSE)`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );

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
    const tokenTeacherA = mint({
      sub: USER_TEACHER_A,
      role: "Enseignant",
      roleKeys: ["TEACHER"],
      schoolCode: LEFTOVER_A,
      permissions: TEACHER_PERMS,
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
    const tokenNoLogin = mint({
      sub: USER_NO_LOGIN,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_NO_LOGIN,
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
    const tokenForgedB = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: PERMS,
    });

    const getA = await request("/presences", { token: tokenA });
    assert.equal(getA.status, 200, `PR-01 GET A: ${JSON.stringify(getA.data)}`);
    const rowsA = unwrapList(getA.data);
    assert.ok(
      rowsA.some((row) => String(row.studentId) === "STU-A-001" || String(row.id) === PRESENCE_A),
      "PR-01: présence A",
    );
    assert.equal(
      rowsA.some((row) => String(row.id) === PRESENCE_B || row.schoolCode === LOGIN_B || row.schoolCode === LEFTOVER_B),
      false,
      "PR-01: jamais B",
    );
    assert.equal(
      rowsA.some((row) => String(row.id) === PRESENCE_A2 || row.schoolCode === LOGIN_A2),
      false,
      "PR-01: jamais A2",
    );
    assert.ok(
      rowsA.every((row) => !row.schoolCode || row.schoolCode === LOGIN_A),
      `PR-01 projection login_code: ${JSON.stringify(rowsA)}`,
    );

    const getForged = await request("/presences", { token: tokenForgedB });
    const forgedRows = unwrapList(getForged.data);
    assert.ok(getForged.status === 200 || getForged.status === 403, `PR-02 status=${getForged.status}`);
    assert.equal(
      forgedRows.some((row) => String(row.id) === PRESENCE_B || row.schoolCode === LOGIN_B || row.schoolCode === LEFTOVER_B),
      false,
      "PR-02: JWT leftover B jamais B",
    );

    const getHeader = await request("/presences", {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    assert.equal(
      unwrapList(getHeader.data).some((row) => String(row.id) === PRESENCE_B),
      false,
      "PR-03: header B jamais B",
    );

    const countBBefore = (
      await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    const postB = await request("/presences", {
      method: "POST",
      token: tokenA,
      body: {
        classCode: CLASS_B,
        teacherId: TEACHER_CODE_B,
        schoolCode: LOGIN_B,
        items: [{ studentId: "STU-B-001", date: "2026-09-01", status: "Présent", classCode: CLASS_B }],
      },
    });
    const countBAfter = (
      await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    assert.ok([400, 403, 404, 409].includes(postB.status), `PR-04 status=${postB.status}`);
    assert.equal(countBAfter, countBBefore, "PR-04 0 write B");

    const postForged = await request("/presences", {
      method: "POST",
      token: tokenForgedB,
      body: {
        classCode: CLASS_B,
        teacherId: TEACHER_CODE_B,
        items: [{ studentId: "STU-B-001", date: "2026-09-02", status: "Présent", classCode: CLASS_B }],
      },
    });
    const countBForged = (
      await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    assert.ok([400, 403, 404, 409].includes(postForged.status), `PR-05 status=${postForged.status}`);
    assert.equal(countBForged, countBBefore, "PR-05 0 write B via leftover");

    const getNoSub = await request("/presences", { token: tokenNoSub });
    assert.equal(getNoSub.status, 403, `PR-06 sans sub status=${getNoSub.status}`);
    const getNoSchool = await request("/presences", { token: tokenNoSchool });
    assert.equal(getNoSchool.status, 403, `PR-07 sans school_id status=${getNoSchool.status}`);
    const getNoLogin = await request("/presences", { token: tokenNoLogin });
    assert.equal(getNoLogin.status, 403, `PR-08 login_code vide status=${getNoLogin.status}`);

    const getB = await request("/presences", { token: tokenB });
    assert.equal(getB.status, 200, `PR-09 GET B status=${getB.status}`);
    assert.equal(
      unwrapList(getB.data).some((row) => String(row.id) === PRESENCE_A || row.schoolCode === LOGIN_A),
      false,
      "PR-09 B jamais A",
    );

    const getPays = await request("/presences", { token: tokenPaysCd });
    assert.ok(getPays.status === 200 || getPays.status === 403, `PR-10 status=${getPays.status}`);
    assert.equal(
      unwrapList(getPays.data).some((row) => String(row.id) === PRESENCE_B || row.schoolCode === LOGIN_B),
      false,
      "PR-10 Admin Pays CD jamais BI",
    );

    const teacherWriteB = await request("/presences", {
      method: "POST",
      token: tokenTeacherA,
      body: {
        classCode: CLASS_B,
        items: [{ studentId: "STU-B-001", date: "2026-09-03", status: "Présent", classCode: CLASS_B }],
      },
    });
    const countBTeacher = (
      await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    assert.ok([400, 403, 404, 409].includes(teacherWriteB.status), `PR-11 status=${teacherWriteB.status}`);
    assert.equal(countBTeacher, countBBefore, "PR-11 enseignant A 0 write B");

    console.log("OK presenceTenant.http.pg.test.js");
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
