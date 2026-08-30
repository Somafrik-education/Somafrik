"use strict";

/**
 * P0 — réconciliation live RBAC Planning pour Préfet / Enseignant déjà présents.
 * Simule une matrice PostgreSQL peuplée avant l'ajout de Planning de cours:* ,
 * puis un redéploiement (bootstrap) qui doit réconcilier JWT + API.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PEDAGOGY_SCHEMA_SQL } = require("../db/pedagogySchema");
const { hashSecret } = require("../services/credentialService");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19891;
const PG_HTTP_DATABASE = String(process.env.SOMAFRIK_PLANNING_RBAC_HTTP_IT_DATABASE ?? "somafrik_planning_rbac_http_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const SCHOOL_CODE = "CD-IN-26-001";
const JWT_SECRET = process.env.JWT_SECRET || "verify-planning-rbac-reconcile-secret-32ch";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl() {
  return `http://127.0.0.1:${PORT}/api`;
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl()}${pathname}`, {
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

function spawnBackend(databaseUrl) {
  const child = spawn("node", ["backend/server.js"], {
    cwd: ROOT,
    detached: true,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
      PORT: String(PORT),
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      DATABASE_URL: databaseUrl,
      JWT_SECRET,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.logs = "";
  const collect = (chunk) => {
    child.logs += String(chunk);
    if (child.logs.length > 32_000) child.logs = child.logs.slice(-24_000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  return child;
}

function killProcessTree(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}\n${child.logs || ""}`);
    }
    try {
      const response = await fetch(`${baseUrl()}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error(`Backend health timeout\n${child.logs || ""}`);
}

async function login(identifier, password) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, schoolCode: SCHOOL_CODE },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result;
}

async function loginWithFallback(identifier, passwords) {
  let last = null;
  for (const password of passwords) {
    const result = await request("/backoffice/login", {
      method: "POST",
      body: { identifier, password, schoolCode: SCHOOL_CODE },
    });
    if (result.status === 200) return result;
    last = result;
  }
  assert.equal(last?.status, 200, JSON.stringify(last?.data));
  return last;
}

async function loginReady(identifier, password) {
  const first = await login(identifier, password);
  let token = first.data.accessToken || first.data.token;
  let data = first.data;
  const changed = await request("/auth/change-password", {
    method: "POST",
    token,
    body: { newPassword: "Planning#2026Aa" },
  });
  if ([200, 201].includes(changed.status)) {
    data = changed.data;
    token = changed.data?.accessToken || (await login(identifier, "Planning#2026Aa")).data.accessToken;
  }
  return { token, data };
}

function decodeJwt(token) {
  const payload = String(token).split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function sessionToken(result) {
  return result?.data?.accessToken || result?.data?.token || result?.token;
}

function sessionPermissions(result) {
  const token = sessionToken(result);
  const jwt = token ? decodeJwt(token) : {};
  return jwt.permissions || result?.data?.permissions || result?.data?.user?.permissions || [];
}

function planningTokens(permissions) {
  return (permissions || []).filter((token) => String(token).startsWith("Planning de cours:"));
}

function assertJwtPlanning(token, expected, label) {
  const jwt = decodeJwt(token);
  const fromJwt = planningTokens(jwt.permissions);
  const missing = expected.filter((tokenName) => !fromJwt.includes(tokenName));
  assert.deepEqual(missing, [], `${label} JWT manque ${JSON.stringify(missing)} (got ${JSON.stringify(fromJwt)})`);
  const extraForbidden = fromJwt.filter((tokenName) => !expected.includes(tokenName));
  if (expected.length <= 1) {
    assert.equal(
      extraForbidden.some((tokenName) => tokenName.endsWith(":CREATE") || tokenName.endsWith(":DELETE")),
      false,
      `${label} JWT ne doit pas élargir les écritures: ${JSON.stringify(fromJwt)}`,
    );
  }
}

async function prepareDatabase(databaseUrl) {
  const isolatedUrl = await ensureIsolatedDatabase(databaseUrl, PG_HTTP_DATABASE);
  const pool = new Pool({ connectionString: isolatedUrl });
  const passwordHash = hashSecret("1234");
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));
    await pool.query(PEDAGOGY_SCHEMA_SQL);
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const schoolA = await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status, profile_payload)
       VALUES ($1, 'CD-2026-0001', 'CD-IN-26-001', 'Lycée IN', 'active', '{"timezone":"Africa/Kinshasa"}'::jsonb) RETURNING id`,
      [country.rows[0].id],
    );
    const year = await pool.query(
      `INSERT INTO academic_years (school_id, name, status) VALUES ($1, '2026-2027', 'open') RETURNING id`,
      [schoolA.rows[0].id],
    );
    const classA = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name, status)
       VALUES ($1, $2, 'CLS-2A', '2ème A', 'active') RETURNING id`,
      [schoolA.rows[0].id, year.rows[0].id],
    );
    const math = await pool.query(
      `INSERT INTO subjects (school_id, subject_code, name, coefficient, status)
       VALUES ($1, 'SUB-MATH', 'Mathématiques', 2, 'active') RETURNING id`,
      [schoolA.rows[0].id],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ADMIN-CD-2026-0001-01', 'Admin', 'HTTP', 'admin-http@test.cd', $2, $2, 'SCHOOL_ADMIN', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'PREFET-CD-2026-0001-01', 'Samuel', 'Prefet', 'prefet-http@test.cd', $2, $2, 'PREFET_ETUDES', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'SECRETAIRE-CD-2026-0001-01', 'Amina', 'Secretaire', 'secretaire-http@test.cd', $2, $2, 'SECRETARY', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, phone, password_hash, pin_hash, role, status)
       VALUES ($1, 'PARENT-CD-2026-0001-01', 'Parent', 'HTTP', 'parent-http@test.cd', '+243 820 000 001', $2, $2, 'PARENT', 'active')`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacherUser = await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES ($1, 'ENS-0001', 'Seke', 'Kilombo', 'seke-http@test.cd', $2, $2, 'TEACHER', 'active') RETURNING id`,
      [schoolA.rows[0].id, passwordHash],
    );
    const teacher = await pool.query(
      `INSERT INTO teachers (school_id, user_id, teacher_code, status)
       VALUES ($1, $2, 'ENS-0001', 'active') RETURNING id`,
      [schoolA.rows[0].id, teacherUser.rows[0].id],
    );
    await pool.query(
      `INSERT INTO teacher_assignments (school_id, teacher_id, class_id, subject_id, academic_year_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [schoolA.rows[0].id, teacher.rows[0].id, classA.rows[0].id, math.rows[0].id, year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO terms (academic_year_id, name, status) VALUES ($1, 'Trimestre 1', 'open')`,
      [year.rows[0].id],
    );
    await pool.query(
      `INSERT INTO subscriptions (school_id, plan_name, price_per_student, billing_currency, billing_cycle, status, start_date)
       VALUES ($1, 'Premium', 10, 'CDF', 'monthly', 'active', '2026-09-01')`,
      [schoolA.rows[0].id],
    );
  } finally {
    await pool.end();
  }
  return isolatedUrl;
}

async function simulateStalePlanningGrants(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `DELETE FROM role_module_permissions
        WHERE module_key = 'planning'
          AND upper(role_key) IN ('PREFET_ETUDES', 'TEACHER')`,
    );
    await pool.query(
      `DELETE FROM establishment_role_permissions
        WHERE permission LIKE 'Planning de cours:%'
          AND role_id IN (
            SELECT id FROM establishment_roles
             WHERE upper(role_code) IN ('PREFET_ETUDES', 'TEACHER')
          )`,
    );
  } finally {
    await pool.end();
  }
}

async function startBackend(databaseUrl) {
  const child = spawnBackend(databaseUrl);
  try {
    await waitForHealth(child);
    return child;
  } catch (error) {
    killProcessTree(child);
    throw error;
  }
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    if (process.env.CI) throw new Error("DATABASE_URL obligatoire pour verify-planning-rbac-reconcile");
    console.log("verify-planning-rbac-reconcile: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await prepareDatabase(databaseUrl);
  let child = await startBackend(isolatedUrl);
  try {
    await simulateStalePlanningGrants(isolatedUrl);
    const stalePrefet = await loginReady("prefet", "1234");
    assert.equal(
      planningTokens(sessionPermissions(stalePrefet)).includes("Planning de cours:READ"),
      false,
      "avant reconciliation le JWT Préfet ne doit pas encore avoir Planning (rôle préexistant périmé)",
    );

    killProcessTree(child);
    child.stdout?.destroy();
    child.stderr?.destroy();
    await wait(500);
    child = await startBackend(isolatedUrl);

    const prefet = await loginWithFallback("prefet", ["Planning#2026Aa", "1234"]);
    const prefetToken = sessionToken(prefet);
    const prefetPerms = planningTokens(sessionPermissions(prefet));
    assert.ok(prefetPerms.includes("Planning de cours:READ"), `Préfet login ${JSON.stringify(prefetPerms)}`);
    assert.ok(prefetPerms.includes("Planning de cours:CREATE"));
    assert.ok(prefetPerms.includes("Planning de cours:UPDATE"));
    assert.ok(prefetPerms.includes("Planning de cours:DELETE"));
    assertJwtPlanning(prefetToken, prefetPerms, "Préfet");
    assert.equal((await request("/course-schedules", { token: prefetToken })).status, 200);
    const prefetLive = await request("/auth/effective-permissions", { token: prefetToken });
    assert.equal(prefetLive.status, 200, JSON.stringify(prefetLive.data));
    assert.ok(
      planningTokens(prefetLive.data?.permissions).includes("Planning de cours:READ"),
      "GET /auth/effective-permissions Préfet",
    );

    const teacher = await loginWithFallback("seke-http@test.cd", ["1234", "Planning#2026Aa"]);
    const teacherToken = sessionToken(teacher);
    const teacherPerms = planningTokens(sessionPermissions(teacher));
    assert.deepEqual(teacherPerms, ["Planning de cours:READ"]);
    assertJwtPlanning(teacherToken, ["Planning de cours:READ"], "Enseignant");
    assert.equal((await request("/course-schedules", { token: teacherToken })).status, 200);
    assert.equal(
      (await request("/course-schedules", { method: "POST", token: teacherToken, body: {} })).status,
      403,
    );
    assert.equal(
      (
        await request("/course-schedules/00000000-0000-4000-8000-000000000001", {
          method: "PATCH",
          token: teacherToken,
          body: { dayOfWeek: 1 },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/course-schedules/00000000-0000-4000-8000-000000000001", {
          method: "DELETE",
          token: teacherToken,
        })
      ).status,
      403,
    );

    const parent = await loginWithFallback("+243 820 000 001", ["1234", "Planning#2026Aa"]);
    const parentToken = sessionToken(parent);
    assert.equal(planningTokens(sessionPermissions(parent)).includes("Planning de cours:READ"), false);
    assert.equal((await request("/course-schedules", { token: parentToken })).status, 403);

    const secretary = await loginReady("secretaire", "1234");
    assert.equal(planningTokens(sessionPermissions(secretary)).includes("Planning de cours:READ"), false);
    assert.equal((await request("/course-schedules", { token: sessionToken(secretary) })).status, 403);

    const admin = await loginWithFallback("admin", ["1234", "Planning#2026Aa"]);
    const adminPerms = planningTokens(sessionPermissions(admin));
    assert.ok(adminPerms.includes("Planning de cours:READ"));
    assert.ok(adminPerms.includes("Planning de cours:CREATE"));

    console.log("OK http-pg: JWT Préfet/Enseignant réconciliés, Teacher writes 403, Parent/Secrétaire inchangés");
  } finally {
    killProcessTree(child);
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    await wait(200);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
