"use strict";

/**
 * GP-020 — SY-08 login_code vide fail-closed + non-régression SY-06/SY-07.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_SYNC_L1_TENANT_IT_DATABASE ?? "somafrik_sync_l1_tenant_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SYNC_L1_TENANT_HTTP_PORT ?? 19898);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const LEFTOVER_NO_LOGIN = "CD-2026-0099";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const USER_NO_LOGIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa07";
const CLASS_A = "CLS-LAC-6A";
const CLASS_B = "CLS-BUJ-6A";
const PERMS = ["ALL_PRIVILEGES", "Voir classes", "Classes:READ"];

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

async function request(pathname, { token } = {}) {
  const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api${pathname}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
     VALUES ($1, $2, $3, 'LAC', 'Lycée Lac', 'active') RETURNING id`,
    [cd.id, LEFTOVER_A, LOGIN_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, login_code, short_code, name, status)
     VALUES ($1, $2, $3, 'BUJ', 'Lycée Bujumbura', 'active') RETURNING id`,
    [bi.id, LEFTOVER_B, LOGIN_B],
  );
  await setLoginCodeTriggers(pool, true);
  const yearA = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolA.rows[0].id],
  );
  const yearB = await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES ($1, '2026-2027', '2026-09-01', '2027-08-31', TRUE, 'open') RETURNING id`,
    [schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
     VALUES ($1, $3, $5, '6ème A Lac', 'active'), ($2, $4, $6, '6ème A Buj', 'active')`,
    [schoolA.rows[0].id, schoolB.rows[0].id, yearA.rows[0].id, yearB.rows[0].id, CLASS_A, CLASS_B],
  );
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $3, 'ADM-A', 'Aline', 'A', 'a@sync.gp.test', 'Admin School', 'active', FALSE),
       ($2, $4, 'ADM-B', 'Binta', 'B', 'b@sync.gp.test', 'Admin School', 'active', FALSE)`,
    [USER_A, USER_B, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES ($1, $3, 'SCHOOL_ADMIN', 'active'), ($2, $4, 'SCHOOL_ADMIN', 'active')`,
    [USER_A, USER_B, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  return { schoolAId: schoolA.rows[0].id, schoolBId: schoolB.rows[0].id };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("mobileSyncTenant.http.pg.test.js: SKIP (DATABASE_URL absent)");
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
    assert.equal(emptySchool.rows[0].login_code, null, "SY-08 fixture login_code vide");
    await pool.query(
      `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
       VALUES ($1, $2, 'ADM-NL', 'Sans', 'Login', 'nl@sync.gp.test', 'Admin School', 'active', FALSE)`,
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
    const tokenNoLogin = mint({
      sub: USER_NO_LOGIN,
      role: "Admin School",
      roleKeys: ["SCHOOL_ADMIN"],
      schoolCode: LEFTOVER_NO_LOGIN,
      permissions: PERMS,
    });

    const getA = await request("/mobile-sync/l1/classes", { token: tokenA });
    assert.equal(getA.status, 200, `SY-01 GET A: ${JSON.stringify(getA.data)}`);
    const itemsA = Array.isArray(getA.data?.items) ? getA.data.items : [];
    assert.equal(
      itemsA.some((row) => String(row.classCode ?? row.class_code) === CLASS_B),
      false,
      "SY-01 jamais B",
    );

    const getForged = await request("/mobile-sync/l1/classes", { token: tokenForgedB });
    assert.ok(getForged.status === 200 || getForged.status === 403, `SY-06 status=${getForged.status}`);
    const forgedItems = Array.isArray(getForged.data?.items) ? getForged.data.items : [];
    assert.equal(
      forgedItems.some((row) => String(row.classCode ?? row.class_code) === CLASS_B),
      false,
      "SY-06 JWT leftover B jamais B",
    );

    const getNoSub = await request("/mobile-sync/l1/classes", { token: tokenNoSub });
    assert.ok([400, 401, 403].includes(getNoSub.status), `SY-07 sans sub status=${getNoSub.status}`);

    const getNoLogin = await request("/mobile-sync/l1/classes", { token: tokenNoLogin });
    assert.ok([400, 401, 403].includes(getNoLogin.status), `SY-08 login_code vide status=${getNoLogin.status}`);
    assert.notEqual(getNoLogin.status, 200, "SY-08 ne doit pas retomber sur leftover");

    console.log("OK mobileSyncTenant.http.pg.test.js");
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
