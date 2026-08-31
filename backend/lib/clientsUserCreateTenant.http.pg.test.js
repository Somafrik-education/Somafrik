"use strict";

/**
 * SYNC-E2E-USERS-TENANT-SCOPE-01 — POST /backoffice/users
 * leftover JWT ≠ login_code : membership UUID, pas d'usurpation.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_USERS_TENANT_IT_DATABASE ?? "somafrik_users_tenant_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_USERS_TENANT_HTTP_PORT ?? 19882);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const USER_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const LEFTOVER_A = "CD-2026-0001";
const LEFTOVER_B = "BI-2026-0001";

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
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 4000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function mintAccess(tokens, claims) {
  return tokens.createAccessToken({
    typ: "access",
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    permissions: ["Utilisateurs:CREATE", "Utilisateurs:READ"],
    ...claims,
  });
}

async function seed(pool) {
  const countryA = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const countryB = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
  );
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, short_code, name, status)
     VALUES ($1, $2, 'SY', 'Lycée A', 'active') RETURNING id, school_code, login_code`,
    [countryA.rows[0].id, LEFTOVER_A],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, short_code, name, status)
     VALUES ($1, $2, 'SY', 'Lycée B', 'active') RETURNING id, school_code, login_code`,
    [countryB.rows[0].id, LEFTOVER_B],
  );
  const canonicalA = String(schoolA.rows[0].login_code ?? "").trim().toUpperCase();
  const canonicalB = String(schoolB.rows[0].login_code ?? "").trim().toUpperCase();
  assert.ok(canonicalA);
  assert.ok(canonicalB);
  assert.notEqual(schoolA.rows[0].school_code, canonicalA);
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $3, 'ADM-USR-A', 'Ada', 'A', 'adm-usr-a@test.local', 'SCHOOL_ADMIN', 'active', FALSE),
       ($2, $4, 'ADM-USR-B', 'Beno', 'B', 'adm-usr-b@test.local', 'SCHOOL_ADMIN', 'active', FALSE)`,
    [USER_A, USER_B, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES ($1, $3, 'SCHOOL_ADMIN', 'active'), ($2, $4, 'SCHOOL_ADMIN', 'active')`,
    [USER_A, USER_B, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  return { canonicalA, canonicalB, schoolIdA: schoolA.rows[0].id };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("clientsUserCreateTenant.http.pg.test.js SKIP (DATABASE_URL absent)");
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
  let child = null;

  try {
    await repo.init();
    const { canonicalA, canonicalB, schoolIdA } = await seed(repo.pool);

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

    const leftoverJwt = mintAccess(tokens, { sub: USER_A, schoolCode: LEFTOVER_A });

    const created = await request("/backoffice/users", {
      method: "POST",
      token: leftoverJwt,
      body: {
        firstName: "User",
        lastName: "Sync",
        email: "user-sync@test.local",
        temporaryPassword: "E2eTest!2026",
      },
    });
    assert.equal(created.status, 201, `create own school: ${JSON.stringify(created.data)}`);
    assert.ok(created.data?.id);
    const persisted = await repo.pool.query(`SELECT school_id FROM users WHERE id = $1`, [created.data.id]);
    assert.equal(String(persisted.rows[0].school_id), String(schoolIdA));
    assert.equal(created.data.schoolPublicCode, canonicalA);
    assert.notEqual(LEFTOVER_A, canonicalA);

    const leftoverBody = await request("/backoffice/users", {
      method: "POST",
      token: leftoverJwt,
      body: {
        firstName: "Leftover",
        lastName: "Ignored",
        email: "leftover-ignored@test.local",
        schoolCode: LEFTOVER_B,
        temporaryPassword: "E2eTest!2026",
      },
    });
    assert.equal(leftoverBody.status, 201, `leftover body ignoré: ${JSON.stringify(leftoverBody.data)}`);
    const leftoverPersisted = await repo.pool.query(`SELECT school_id FROM users WHERE id = $1`, [
      leftoverBody.data.id,
    ]);
    assert.equal(String(leftoverPersisted.rows[0].school_id), String(schoolIdA));

    const usurped = await request("/backoffice/users", {
      method: "POST",
      token: leftoverJwt,
      body: {
        firstName: "Other",
        lastName: "Tenant",
        email: "other-tenant@test.local",
        schoolCode: canonicalB,
        temporaryPassword: "E2eTest!2026",
      },
    });
    assert.equal(usurped.status, 403, `usurpation refusée: ${JSON.stringify(usurped.data)}`);

    const countryOk = await request("/backoffice/users", {
      method: "POST",
      token: leftoverJwt,
      body: {
        firstName: "Country",
        lastName: "Match",
        email: "country-ok@test.local",
        countryCode: "CD",
        temporaryPassword: "E2eTest!2026",
      },
    });
    assert.equal(countryOk.status, 201, `countryCode valide: ${JSON.stringify(countryOk.data)}`);
    const countryPersisted = await repo.pool.query(`SELECT school_id FROM users WHERE id = $1`, [
      countryOk.data.id,
    ]);
    assert.equal(String(countryPersisted.rows[0].school_id), String(schoolIdA));

    console.log("OK clientsUserCreateTenant.http.pg.test.js — leftover JWT, membership, isolation");
  } finally {
    await stopChild(child);
    if (typeof repo.close === "function") await repo.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
