"use strict";

/**
 * GP-002 — leftover JWT ≠ login_code du même tenant.
 * Dual-identity A/B + fail-closed + cache + Superadmin / Admin Pays.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_ACADEMIC_YEAR_GP002_IT_DATABASE ?? "somafrik_academic_year_gp002_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_ACADEMIC_YEAR_GP002_HTTP_PORT ?? 19881);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const USER_NO_SCHOOL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";
const USER_NO_LOGIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04";
const USER_SUPER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa05";
const USER_PAYS_CD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa06";

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

function yearBody(name, extra = {}) {
  const [start, end] = String(name).split("-");
  return {
    name,
    startDate: `${start}-09-01`,
    endDate: `${end}-08-31`,
    isCurrent: true,
    ...extra,
  };
}

async function setRoleModuleGrant(pool, roleKey, moduleKey, flags) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = upper($1) AND module_key = $2 AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
    [roleKey, moduleKey],
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_create = $2, can_read = $3, can_update = $4, can_delete = FALSE, updated_by = 'gp002', updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, flags.create, flags.read, flags.update],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ($1, 'global', $2, $3, $4, $5, FALSE, 'gp002')`,
    [roleKey, moduleKey, flags.create, flags.read, flags.update],
  );
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

  assert.equal(schoolA.rows[0].school_code, LEFTOVER_A);
  assert.equal(schoolA.rows[0].login_code, LOGIN_A);
  assert.notEqual(schoolA.rows[0].school_code, schoolA.rows[0].login_code);
  assert.equal(schoolB.rows[0].school_code, LEFTOVER_B);
  assert.equal(schoolB.rows[0].login_code, LOGIN_B);

  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2024-2025', '2024-09-01', '2025-08-31', TRUE, 'open')
     RETURNING id, name`,
    [schoolA.rows[0].id],
  );
  const yearB =   await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2024-2025', '2024-09-01', '2025-08-31', TRUE, 'open')
     RETURNING id, name`,
    [schoolB.rows[0].id],
  );

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $6, 'ADM-A', 'Aline', 'A', 'a@gp002.test', 'Admin School', 'active', FALSE),
       ($2, $7, 'ADM-B', 'Binta', 'B', 'b@gp002.test', 'Admin School', 'active', FALSE),
       ($3, NULL, 'ADM-NS', 'Sans', 'Ecole', 'ns@gp002.test', 'Admin School', 'active', FALSE),
       ($4, NULL, 'SUPER', 'Super', 'Admin', 'super@gp002.test', 'Super Administrateur Somafrik', 'active', FALSE),
       ($5, NULL, 'PAYS-CD', 'Admin', 'Pays', 'pays@gp002.test', 'Admin Pays', 'active', FALSE)`,
    [USER_A, USER_B, USER_NO_SCHOOL, USER_SUPER, USER_PAYS_CD, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $6, 'SCHOOL_ADMIN', 'active'),
       ($2, $7, 'SCHOOL_ADMIN', 'active'),
       ($3, $6, 'SCHOOL_ADMIN', 'active'),
       ($4, NULL, 'SUPER_ADMIN', 'active'),
       ($5, NULL, 'COUNTRY_ADMIN', 'active')`,
    [USER_A, USER_B, USER_NO_SCHOOL, USER_SUPER, USER_PAYS_CD, schoolA.rows[0].id, schoolB.rows[0].id],
  );

  await setRoleModuleGrant(pool, "SCHOOL_ADMIN", "academic_years", { create: true, read: true, update: true });
  await setRoleModuleGrant(pool, "COUNTRY_ADMIN", "academic_years", { create: true, read: true, update: true });
  await setRoleModuleGrant(pool, "SUPER_ADMIN", "academic_years", { create: true, read: true, update: true });

  return {
    schoolAId: schoolA.rows[0].id,
    schoolBId: schoolB.rows[0].id,
    yearAId: yearA.rows[0].id,
    yearBId: yearB.rows[0].id,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("academicYearTenant.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
       VALUES ($1, 'CD-2026-0099', NULL, 'SLG', 'École sans login', 'active')
       RETURNING id, school_code, login_code`,
      [cdId],
    );
    assert.equal(emptySchool.rows[0].login_code, null, "P0-7 fixture login_code vide");
    await pool.query(
      `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
       VALUES ($1, '2024-2025', '2024-09-01', '2025-08-31', TRUE, 'open')`,
      [emptySchool.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'ADM-NL', 'Sans', 'Login', 'nl@gp002.test', 'Admin School', 'active', FALSE)`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'SCHOOL_ADMIN', 'active')`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );

    const tokenA = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: ["Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE"],
    });
    const tokenB = mint({
      sub: USER_B,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: ["Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE"],
    });
    const tokenNoSub = mint({
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: ["Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE", "ALL_PRIVILEGES"],
    });
    const tokenNoSchool = mint({
      sub: USER_NO_SCHOOL,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_A,
      permissions: ["Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE"],
    });
    const tokenNoLogin = mint({
      sub: USER_NO_LOGIN,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: "CD-2026-0099",
      permissions: ["Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE"],
    });
    const tokenSuper = mint({
      sub: USER_SUPER,
      role: "Super Administrateur Somafrik",
      roleKeys: ["SUPER_ADMIN"],
      schoolCode: "*",
      permissions: ["ALL_PRIVILEGES"],
    });
    const tokenPaysCd = mint({
      sub: USER_PAYS_CD,
      role: "Admin Pays",
      roleKeys: ["COUNTRY_ADMIN"],
      schoolCode: "*",
      countryCode: "CD",
      permissions: ["Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE"],
    });
    const tokenForgedB = mint({
      sub: USER_A,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_B,
      permissions: ["Années Académiques:READ", "Années Académiques:CREATE", "Années Académiques:UPDATE"],
    });

    const getA = await request("/v2/academic-years", { token: tokenA });
    assert.equal(getA.status, 200, `P0-1 GET A: ${JSON.stringify(getA.data)}`);
    const yearsA = unwrapList(getA.data);
    assert.ok(yearsA.length >= 1, "P0-1: user A voit ses années");
    assert.ok(
      yearsA.every((row) => row.schoolCode === LOGIN_A && row.schoolId === fixture.schoolAId),
      `P0-1 projection login_code A, jamais leftover: ${JSON.stringify(yearsA)}`,
    );
    assert.equal(
      yearsA.some((row) => row.schoolCode === LEFTOVER_A || row.schoolCode === LOGIN_B),
      false,
    );

    const postOmitted = await request("/v2/academic-years", {
      method: "POST",
      token: tokenA,
      body: yearBody("2026-2027"),
    });
    assert.equal(postOmitted.status, 201, `P0-2 POST body omis: ${JSON.stringify(postOmitted.data)}`);
    assert.equal(postOmitted.data.schoolCode, LOGIN_A, "P0-2 projection canonique A");
    assert.equal(postOmitted.data.schoolId, fixture.schoolAId);
    assert.notEqual(postOmitted.data.schoolCode, LEFTOVER_A);

    const countBBefore = (
      await pool.query(`SELECT count(*)::int AS c FROM academic_years WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    const postBodyB = await request("/v2/academic-years", {
      method: "POST",
      token: tokenA,
      body: yearBody("2027-2028", { schoolCode: LOGIN_B }),
    });
    assert.ok(postBodyB.status === 403, `P0-3 POST body B: ${postBodyB.status} ${JSON.stringify(postBodyB.data)}`);
    const countBAfter = (
      await pool.query(`SELECT count(*)::int AS c FROM academic_years WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    assert.equal(countBAfter, countBBefore, "P0-3: 0 write B");

    const getForgedJwt = await request("/v2/academic-years", { token: tokenForgedB });
    const forgedYears = unwrapList(getForgedJwt.data);
    assert.ok(
      getForgedJwt.status === 403 || forgedYears.every((row) => row.schoolCode === LOGIN_A || row.schoolId === fixture.schoolAId),
      `P0-4 JWT leftover B: ${getForgedJwt.status} ${JSON.stringify(getForgedJwt.data)}`,
    );
    assert.equal(
      forgedYears.some((row) => row.schoolCode === LOGIN_B || row.schoolId === fixture.schoolBId),
      false,
      "P0-4: jamais B",
    );

    const getForgedHeader = await request("/v2/academic-years", {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    const headerYears = unwrapList(getForgedHeader.data);
    assert.ok(
      getForgedHeader.status === 403 || headerYears.every((row) => row.schoolCode === LOGIN_A),
      `P0-4 header B: ${getForgedHeader.status} ${JSON.stringify(getForgedHeader.data)}`,
    );
    assert.equal(
      headerYears.some((row) => row.schoolCode === LOGIN_B),
      false,
      "P0-4 header: jamais B",
    );

    const getNoSub = await request("/v2/academic-years", { token: tokenNoSub });
    assert.ok(getNoSub.status === 403 || getNoSub.status === 401, `P0-5 sans sub: ${getNoSub.status}`);
    assert.equal(unwrapList(getNoSub.data).some((row) => row.schoolCode === LOGIN_B || row.schoolCode === LEFTOVER_A), false);

    const getNoSchool = await request("/v2/academic-years", { token: tokenNoSchool });
    assert.equal(getNoSchool.status, 403, `P0-6 sans school_id: ${JSON.stringify(getNoSchool.data)}`);
    const postNoSchool = await request("/v2/academic-years", {
      method: "POST",
      token: tokenNoSchool,
      body: yearBody("2028-2029"),
    });
    assert.equal(postNoSchool.status, 403, "P0-6 POST sans school_id");

    const getNoLogin = await request("/v2/academic-years", { token: tokenNoLogin });
    assert.equal(getNoLogin.status, 403, `P0-7 login_code vide: ${JSON.stringify(getNoLogin.data)}`);
    assert.equal(
      unwrapList(getNoLogin.data).some((row) => row.schoolCode === "CD-2026-0099"),
      false,
      "P0-7: aucun fallback leftover",
    );
    const postNoLogin = await request("/v2/academic-years", {
      method: "POST",
      token: tokenNoLogin,
      body: yearBody("2028-2029", { schoolCode: "CD-2026-0099" }),
    });
    assert.equal(postNoLogin.status, 403, "P0-7 POST leftover n'est pas un fallback");

    const yearABefore = await pool.query(`SELECT name, updated_at FROM academic_years WHERE id = $1`, [fixture.yearAId]);
    const patchCross = await request(`/v2/academic-years/${fixture.yearAId}`, {
      method: "PATCH",
      token: tokenB,
      body: { name: "2099-2100" },
    });
    assert.equal(patchCross.status, 403, `P0-8 PATCH A par B: ${JSON.stringify(patchCross.data)}`);
    const yearAAfter = await pool.query(`SELECT name, updated_at FROM academic_years WHERE id = $1`, [fixture.yearAId]);
    assert.equal(yearAAfter.rows[0].name, yearABefore.rows[0].name, "P0-8: aucune mutation");
    assert.equal(String(yearAAfter.rows[0].updated_at), String(yearABefore.rows[0].updated_at));

    const getSuper = await request("/v2/academic-years", { token: tokenSuper });
    assert.equal(getSuper.status, 200, `P0-9 Superadmin: ${JSON.stringify(getSuper.data)}`);
    const superYears = unwrapList(getSuper.data);
    assert.ok(superYears.some((row) => row.schoolCode === LOGIN_A));
    assert.ok(superYears.some((row) => row.schoolCode === LOGIN_B));
    assert.equal(superYears.some((row) => row.schoolCode === LEFTOVER_A || row.schoolCode === LEFTOVER_B), false);

    const getPays = await request("/v2/academic-years", { token: tokenPaysCd });
    assert.equal(getPays.status, 200, `P0-10 Admin Pays GET: ${JSON.stringify(getPays.data)}`);
    const paysYears = unwrapList(getPays.data);
    assert.ok(paysYears.every((row) => row.countryCode === "CD" && row.schoolCode !== LOGIN_B));
    assert.ok(paysYears.some((row) => row.schoolCode === LOGIN_A));
    const patchPaysBi = await request(`/v2/academic-years/${fixture.yearBId}`, {
      method: "PATCH",
      token: tokenPaysCd,
      body: { name: "2098-2099" },
    });
    assert.equal(patchPaysBi.status, 403, `P0-10 Admin Pays CD ne patch pas BI: ${JSON.stringify(patchPaysBi.data)}`);
    const yearBUnchanged = await pool.query(`SELECT name FROM academic_years WHERE id = $1`, [fixture.yearBId]);
    assert.equal(yearBUnchanged.rows[0].name, "2024-2025");

    const getB = await request("/v2/academic-years", { token: tokenB });
    assert.equal(getB.status, 200, `P0-11 GET B après cache A: ${JSON.stringify(getB.data)}`);
    const yearsB = unwrapList(getB.data);
    assert.ok(yearsB.length >= 1);
    assert.ok(yearsB.every((row) => row.schoolCode === LOGIN_B && row.schoolId === fixture.schoolBId));
    assert.equal(yearsB.some((row) => row.schoolCode === LOGIN_A), false, "P0-11 cache ne fuit pas A vers B");

    const getAAgain = await request("/v2/academic-years", { token: tokenA });
    const yearsAAgain = unwrapList(getAAgain.data);
    assert.ok(yearsAAgain.every((row) => row.schoolCode === LOGIN_A));
    assert.equal(yearsAAgain.some((row) => row.schoolCode === LOGIN_B), false, "P0-11 cache ne fuit pas B vers A");

    console.log("OK academicYearTenant.http.pg.test.js — P0 dual-identity leftover ≠ login_code");
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
