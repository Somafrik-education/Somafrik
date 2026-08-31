"use strict";

/**
 * SYNC-E2E-ACADEMIC-YEAR-READ-SCOPE-01 — GET /v2/academic-years + ensureSchoolYear.
 * leftover ≠ login_code : lecture membership UUID, projection login_code, pas de POST 409.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { ensureSchoolYear } = require("./canonicalClassHttp");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_AY_READ_IT_DATABASE ?? "somafrik_ay_read_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_AY_READ_HTTP_PORT ?? 19881);
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

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
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
    permissions: ["Années Académiques:CREATE", "Années Académiques:READ"],
    ...claims,
  });
}

async function grantAcademicYears(pool) {
  const existing = await pool.query(
    `SELECT id FROM role_module_permissions
     WHERE upper(role_key) = 'SCHOOL_ADMIN' AND module_key = 'academic_years'
       AND scope_type = 'global' AND status = 'active'
     LIMIT 1`,
  );
  if (existing.rowCount) {
    await pool.query(
      `UPDATE role_module_permissions
       SET can_create = TRUE, can_read = TRUE, can_update = TRUE, can_delete = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id],
    );
    return;
  }
  await pool.query(
    `INSERT INTO role_module_permissions (
       role_key, scope_type, module_key, can_create, can_read, can_update, can_delete, updated_by
     )
     VALUES ('SCHOOL_ADMIN', 'global', 'academic_years', TRUE, TRUE, TRUE, FALSE, 'ay-read')`,
  );
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
  assert.ok(canonicalA, "login_code A manquant après INSERT leftover");
  assert.ok(canonicalB, "login_code B manquant après INSERT leftover");
  assert.notEqual(schoolA.rows[0].school_code, canonicalA, "leftover A ≠ login_code");
  assert.notEqual(schoolB.rows[0].school_code, canonicalB, "leftover B ≠ login_code");
  await pool.query(
    `INSERT INTO users (id, school_id, user_code, first_name, last_name, email, role, status, must_change_password)
     VALUES
       ($1, $3, 'ADM-AY-A', 'Ada', 'A', 'adm-ay-a@test.local', 'SCHOOL_ADMIN', 'active', FALSE),
       ($2, $4, 'ADM-AY-B', 'Beno', 'B', 'adm-ay-b@test.local', 'SCHOOL_ADMIN', 'active', FALSE)`,
    [USER_A, USER_B, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO user_roles (user_id, school_id, role_key, status)
     VALUES ($1, $3, 'SCHOOL_ADMIN', 'active'), ($2, $4, 'SCHOOL_ADMIN', 'active')`,
    [USER_A, USER_B, schoolA.rows[0].id, schoolB.rows[0].id],
  );
  await pool.query(
    `INSERT INTO academic_years (school_id, name, start_date, end_date, is_current, status)
     VALUES
       ($1, '2025-2026', '2025-09-01', '2026-08-31', TRUE, 'open'),
       ($2, '2025-2026', '2025-09-01', '2026-08-31', TRUE, 'open')`,
    [schoolA.rows[0].id, schoolB.rows[0].id],
  );
  await grantAcademicYears(pool);
  return { canonicalA, canonicalB, schoolIdA: schoolA.rows[0].id };
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis pour academicYearReadScope.http.pg.test.js");
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

    const leftoverJwt = mintAccess(tokens, {
      sub: USER_A,
      schoolCode: LEFTOVER_A,
    });

    const listed = await request("/v2/academic-years", { token: leftoverJwt });
    assert.equal(listed.status, 200, `GET canonique: ${JSON.stringify(listed.data)}`);
    const rows = extractList(listed.data);
    assert.equal(rows.length, 1, `un seul tenant: ${JSON.stringify(rows)}`);
    assert.equal(rows[0].schoolCode, canonicalA);
    assert.notEqual(rows[0].schoolCode, LEFTOVER_A);
    assert.equal(rows.some((row) => row.schoolCode === canonicalB), false);

    const reused = await ensureSchoolYear(request, leftoverJwt, "2025-2026", canonicalA);
    assert.equal(reused.name, "2025-2026");
    assert.equal(reused.schoolCode, canonicalA);

    const leftoverReuse = await ensureSchoolYear(request, leftoverJwt, "2025-2026", LEFTOVER_A);
    assert.equal(leftoverReuse.id, reused.id);

    const count = await repo.pool.query(
      `SELECT count(*)::int AS c FROM academic_years WHERE school_id = $1 AND name = '2025-2026'`,
      [schoolIdA],
    );
    assert.equal(count.rows[0].c, 1, "ensureSchoolYear ne POST plus (pas de 409 / doublon)");

    console.log("OK academicYearReadScope.http.pg.test.js — GET login_code, isolation, reuse sans POST");
  } finally {
    await stopChild(child);
    if (typeof repo.close === "function") await repo.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
