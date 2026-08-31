"use strict";

/**
 * GP-003 — leftover JWT ≠ login_code du même tenant.
 * Dual-identity A/B Users list/create/update/grant/reset + fail-closed.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_USERS_GP003_IT_DATABASE ?? "somafrik_users_gp003_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_USERS_GP003_HTTP_PORT ?? 19882);
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
const STAFF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const STAFF_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12";

const USER_PERMS = ["Utilisateurs:READ", "Utilisateurs:CREATE", "Utilisateurs:UPDATE"];

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

  assert.notEqual(schoolA.rows[0].school_code, schoolA.rows[0].login_code);
  assert.notEqual(schoolB.rows[0].school_code, schoolB.rows[0].login_code);

  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $8, 'ADM-A', 'Aline', 'A', 'a@gp003.test', 'Admin School', 'active', FALSE),
       ($2, $9, 'ADM-B', 'Binta', 'B', 'b@gp003.test', 'Admin School', 'active', FALSE),
       ($3, NULL, 'ADM-NS', 'Sans', 'Ecole', 'ns@gp003.test', 'Admin School', 'active', FALSE),
       ($4, NULL, 'SUPER', 'Super', 'Admin', 'super@gp003.test', 'Super Administrateur Somafrik', 'active', FALSE),
       ($5, NULL, 'PAYS-CD', 'Admin', 'Pays', 'pays@gp003.test', 'Admin Pays', 'active', FALSE),
       ($6, $8, 'STAFF-A', 'Serge', 'A', 'sa@gp003.test', 'Secrétaire', 'active', FALSE),
       ($7, $9, 'STAFF-B', 'Sara', 'B', 'sb@gp003.test', 'Secrétaire', 'active', FALSE)`,
    [USER_A, USER_B, USER_NO_SCHOOL, USER_SUPER, USER_PAYS_CD, STAFF_A, STAFF_B, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES
       ($1, $8, 'SCHOOL_ADMIN', 'active'),
       ($2, $9, 'SCHOOL_ADMIN', 'active'),
       ($3, $8, 'SCHOOL_ADMIN', 'active'),
       ($4, NULL, 'SUPER_ADMIN', 'active'),
       ($5, NULL, 'COUNTRY_ADMIN', 'active'),
       ($6, $8, 'SECRETARY', 'active'),
       ($7, $9, 'SECRETARY', 'active')`,
    [USER_A, USER_B, USER_NO_SCHOOL, USER_SUPER, USER_PAYS_CD, STAFF_A, STAFF_B, schoolA.rows[0].id, schoolB.rows[0].id],
  );

  return { schoolAId: schoolA.rows[0].id, schoolBId: schoolB.rows[0].id };
}

function mintFactory(tokens) {
  return (payload) => tokens.createAccessToken({ mustChangePassword: false, ...payload });
}

async function main() {
  if (!DATABASE_URL) {
    console.log("usersTenant.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
  const mint = mintFactory(tokens);
  const pool = new Pool({ connectionString: isolatedUrl });
  let child = null;

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
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'ADM-NL', 'Sans', 'Login', 'nl@gp003.test', 'Admin School', 'active', FALSE)`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status)
       VALUES ($1, $2, 'SCHOOL_ADMIN', 'active')`,
      [USER_NO_LOGIN, emptySchool.rows[0].id],
    );

    const tokenA = mint({ sub: USER_A, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_A, permissions: USER_PERMS });
    const tokenB = mint({ sub: USER_B, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_B, permissions: USER_PERMS });
    const tokenNoSub = mint({ role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_A, permissions: [...USER_PERMS, "ALL_PRIVILEGES"] });
    const tokenNoSchool = mint({ sub: USER_NO_SCHOOL, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_A, permissions: USER_PERMS });
    const tokenNoLogin = mint({ sub: USER_NO_LOGIN, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: "CD-2026-0099", permissions: USER_PERMS });
    const tokenSuper = mint({ sub: USER_SUPER, role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], schoolCode: "*", permissions: ["ALL_PRIVILEGES"] });
    const tokenPaysCd = mint({ sub: USER_PAYS_CD, role: "Admin Pays", roleKeys: ["COUNTRY_ADMIN"], schoolCode: "*", countryCode: "CD", permissions: USER_PERMS });
    const tokenForgedB = mint({ sub: USER_A, role: "Admin School", roleKeys: ["SCHOOL_ADMIN"], schoolCode: LEFTOVER_B, permissions: USER_PERMS });

    const getA = await request("/backoffice/users", { token: tokenA });
    assert.equal(getA.status, 200, `P0-1 GET A: ${JSON.stringify(getA.data)}`);
    const usersA = unwrapList(getA.data);
    assert.ok(usersA.length >= 1, "P0-1: user A voit ses comptes");
    assert.ok(
      usersA.every((row) => row.schoolCode === LOGIN_A && (row.schoolId === fixture.schoolAId || !row.schoolId)),
      `P0-1 projection login_code A: ${JSON.stringify(usersA.map((row) => ({ id: row.id, schoolCode: row.schoolCode, schoolId: row.schoolId })))}`,
    );
    assert.equal(usersA.some((row) => row.schoolCode === LEFTOVER_A || row.schoolCode === LOGIN_B || row.id === STAFF_B), false);

    const countBBefore = (
      await pool.query(`SELECT count(*)::int AS c FROM users WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    const postOmitted = await request("/backoffice/users", {
      method: "POST",
      token: tokenA,
      body: { firstName: "Nouveau", lastName: "A", email: "new.a@gp003.test" },
    });
    assert.equal(postOmitted.status, 201, `P0-2 POST body omis: ${JSON.stringify(postOmitted.data)}`);
    assert.equal(postOmitted.data.schoolCode, LOGIN_A, "P0-2 projection canonique A");
    assert.equal(postOmitted.data.schoolId, fixture.schoolAId);
    assert.notEqual(postOmitted.data.schoolCode, LEFTOVER_A);

    const postBodyB = await request("/backoffice/users", {
      method: "POST",
      token: tokenA,
      body: { firstName: "Intrus", lastName: "B", email: "intrus.b@gp003.test", schoolCode: LOGIN_B },
    });
    assert.equal(postBodyB.status, 403, `P0-3 POST body B: ${postBodyB.status} ${JSON.stringify(postBodyB.data)}`);
    const countBAfter = (
      await pool.query(`SELECT count(*)::int AS c FROM users WHERE school_id = $1`, [fixture.schoolBId])
    ).rows[0].c;
    assert.equal(countBAfter, countBBefore, "P0-3: 0 write B");

    const getForgedJwt = await request("/backoffice/users", { token: tokenForgedB });
    const forgedUsers = unwrapList(getForgedJwt.data);
    assert.ok(
      getForgedJwt.status === 403 || forgedUsers.every((row) => row.schoolCode === LOGIN_A || row.schoolId === fixture.schoolAId),
      `P0-4 JWT leftover B: ${getForgedJwt.status} ${JSON.stringify(getForgedJwt.data)}`,
    );
    assert.equal(forgedUsers.some((row) => row.schoolCode === LOGIN_B || row.id === STAFF_B), false, "P0-4: jamais B");

    const getForgedHeader = await request("/backoffice/users", {
      token: tokenA,
      headers: { "X-Somafrik-School-Code": LOGIN_B },
    });
    const headerUsers = unwrapList(getForgedHeader.data);
    assert.equal(headerUsers.some((row) => row.schoolCode === LOGIN_B), false, "P0-4 header: jamais B");

    const getNoSub = await request("/backoffice/users", { token: tokenNoSub });
    assert.ok(getNoSub.status === 403 || getNoSub.status === 401, `P0-5 sans sub: ${getNoSub.status}`);

    const getNoSchool = await request("/backoffice/users", { token: tokenNoSchool });
    assert.equal(getNoSchool.status, 403, `P0-6 sans school_id: ${JSON.stringify(getNoSchool.data)}`);

    const getNoLogin = await request("/backoffice/users", { token: tokenNoLogin });
    assert.equal(getNoLogin.status, 403, `P0-7 login_code vide: ${JSON.stringify(getNoLogin.data)}`);
    assert.equal(unwrapList(getNoLogin.data).some((row) => row.schoolCode === "CD-2026-0099"), false);

    const staffABefore = await pool.query(`SELECT first_name, updated_at FROM users WHERE id = $1`, [STAFF_A]);
    const patchCross = await request(`/backoffice/users/${STAFF_A}`, {
      method: "PATCH",
      token: tokenB,
      body: { firstName: "Hacked" },
    });
    assert.equal(patchCross.status, 403, `P0-8 PATCH A par B: ${JSON.stringify(patchCross.data)}`);
    const staffAAfter = await pool.query(`SELECT first_name FROM users WHERE id = $1`, [STAFF_A]);
    assert.equal(staffAAfter.rows[0].first_name, staffABefore.rows[0].first_name);

    const grantCross = await request(`/backoffice/users/${STAFF_A}/roles/grant`, {
      method: "POST",
      token: tokenB,
      body: { role: "Comptable" },
    });
    assert.equal(grantCross.status, 403, `P0-8 GRANT A par B: ${JSON.stringify(grantCross.data)}`);

    const resetCross = await request(`/users/${STAFF_A}/reset-password`, {
      method: "POST",
      token: tokenB,
      body: { temporaryPassword: "Tmp-reset-ok-12" },
    });
    assert.ok(resetCross.status === 403 || resetCross.status === 404, `P0-8 RESET A par B: ${resetCross.status}`);

    const grantPriv = await request(`/backoffice/users/${STAFF_A}/roles/grant`, {
      method: "POST",
      token: tokenA,
      body: { role: "Super Administrateur Somafrik" },
    });
    assert.equal(grantPriv.status, 403, `P0 comptes privilégiés: ${JSON.stringify(grantPriv.data)}`);

    const getSuper = await request("/backoffice/users", { token: tokenSuper });
    assert.equal(getSuper.status, 200, "P0-9 Superadmin GET");
    const superUsers = unwrapList(getSuper.data);
    assert.ok(superUsers.some((row) => row.schoolCode === LOGIN_A || row.id === STAFF_A));
    assert.ok(superUsers.some((row) => row.schoolCode === LOGIN_B || row.id === STAFF_B));

    const getPays = await request("/backoffice/users", { token: tokenPaysCd });
    assert.equal(getPays.status, 200, `P0-10 Admin Pays GET: ${JSON.stringify(getPays.data)}`);
    const paysUsers = unwrapList(getPays.data);
    assert.equal(paysUsers.some((row) => row.schoolCode === LOGIN_B || row.id === STAFF_B), false, "P0-10 jamais BI");
    assert.ok(paysUsers.every((row) => !row.schoolCode || row.schoolCode === LOGIN_A || row.countryCode === "CD" || row.schoolCode === "*"));

    const patchPaysBi = await request(`/backoffice/users/${STAFF_B}`, {
      method: "PATCH",
      token: tokenPaysCd,
      body: { firstName: "Nope" },
    });
    assert.equal(patchPaysBi.status, 403, `P0-10 Admin Pays CD ne patch pas BI: ${JSON.stringify(patchPaysBi.data)}`);

    const getB = await request("/backoffice/users", { token: tokenB });
    assert.equal(getB.status, 200, `P0-11 GET B: ${JSON.stringify(getB.data)}`);
    const usersB = unwrapList(getB.data);
    assert.ok(usersB.every((row) => row.schoolCode === LOGIN_B));
    assert.equal(usersB.some((row) => row.schoolCode === LOGIN_A || row.id === STAFF_A), false, "P0-11 jamais A");

    console.log("OK usersTenant.http.pg.test.js — P0 dual-identity leftover ≠ login_code");
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
