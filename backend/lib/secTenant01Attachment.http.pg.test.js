"use strict";

/**
 * SEC-TENANT-01 — rattachement établissement, parcours HTTP PostgreSQL réels.
 *
 * Contrat canonique (GP-003) : principal.sub → users.id → users.school_id → schools.id.
 *  1. users.school_id présent + rôle scolaire actif : connexion Web/Mobile autorisée.
 *  2. users.school_id absent, rôle actif seulement dans user_roles : refus (fail-closed).
 *  3. Aucun rattachement : refus.
 *  4. Plusieurs rattachements : seul l'établissement principal ; aucune sélection d'un autre.
 *  + session existante portant schoolCode "*" pour un rôle scolaire : refus, logout possible.
 *  + refresh après retrait de l'établissement : 401 et session révoquée.
 *  + Superadmin (et multi-rôles plateforme) : portée plateforme, données personnelles refusées.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const { TokenService } = require("../services/tokenService");
const { hashSecret } = require("../services/credentialService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_sec_tenant_01_http_it";
const ROOT = path.resolve(__dirname, "../..");
const HTTP_PORT = Number(process.env.SOMAFRIK_SEC_TENANT_01_HTTP_PORT ?? 19931);
const JWT_SECRET = process.env.JWT_SECRET || "ci-test-secret-with-enough-length-for-production-checks";
const SECRET = "Sec-Tenant-01!";
const PIN = "482915";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function resetIsolatedDatabase() {
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  return url;
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
  return { status: response.status, data, text };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Backend exited early: ${child.exitCode}\n${stderrRef.value}`);
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

async function seed(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency, is_active)
     VALUES ('RDC', 'CD', '+243', 'CDF', TRUE)
     ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const insertSchool = async (code, shortCode, name) =>
    (
      await pool.query(
        `INSERT INTO schools (country_id, school_code, short_code, name, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id, login_code`,
        [country.rows[0].id, code, shortCode, name],
      )
    ).rows[0];
  const schoolA = await insertSchool("CD-2026-0911", "STA", "Institut Tenant A");
  const schoolB = await insertSchool("CD-2026-0912", "STB", "Institut Tenant B");

  const passwordHash = hashSecret(SECRET);
  const pinHash = hashSecret(PIN);
  const insertUser = async (userCode, schoolId, role, firstName, lastName) =>
    (
      await pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, role, status,
                            password_hash, pin_hash, must_change_password, profile_payload)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, FALSE, $8::jsonb)
         RETURNING id`,
        [schoolId, userCode, firstName, lastName, role, passwordHash, pinHash, JSON.stringify({ countryCode: "CD" })],
      )
    ).rows[0].id;
  const grant = (userId, schoolId, roleKey) =>
    pool.query(`INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, $3, 'active')`, [
      userId,
      schoolId,
      roleKey,
    ]);

  const attached = await insertUser("ST01-ADMIN-A", schoolA.id, "SCHOOL_ADMIN", "Ada", "Mbala");
  await grant(attached, schoolA.id, "SCHOOL_ADMIN");
  const roleOnly = await insertUser("ST01-SEC-ROLEONLY", null, "SECRETARY", "Rita", "Kanza");
  await grant(roleOnly, schoolB.id, "SECRETARY");
  const unattached = await insertUser("ST01-DIR-NONE", null, "PRINCIPAL", "Dina", "Lufu");
  await grant(unattached, null, "PRINCIPAL").catch(() => null);
  const multi = await insertUser("ST01-MULTI", schoolA.id, "SCHOOL_ADMIN", "Moise", "Tala");
  await grant(multi, schoolA.id, "SCHOOL_ADMIN");
  await grant(multi, schoolB.id, "SECRETARY");
  const superadmin = await insertUser("ST01-SUPER", null, "SUPER_ADMIN", "Sam", "Root");
  await grant(superadmin, null, "SUPER_ADMIN");
  const superTeacher = await insertUser("ST01-SUPER-TEACH", schoolA.id, "SUPER_ADMIN", "Tom", "Duo");
  await grant(superTeacher, null, "SUPER_ADMIN");
  await grant(superTeacher, schoolA.id, "TEACHER");

  await pool.query(
    `INSERT INTO students (school_id, first_name, last_name, status) VALUES ($1, 'Eleve', 'Alpha', 'active'), ($2, 'Eleve', 'Beta', 'active')`,
    [schoolA.id, schoolB.id],
  );

  return { schoolA, schoolB, users: { attached, roleOnly, unattached, multi, superadmin, superTeacher } };
}

async function webLogin(identifier, schoolCode) {
  return request("/backoffice/login", {
    method: "POST",
    body: { identifier, password: SECRET, ...(schoolCode ? { schoolCode } : {}) },
  });
}

async function mobileLogin(role, identifier, schoolCode) {
  return request("/login", { method: "POST", body: { role, identifier, pin: PIN, schoolCode } });
}

function assertRefused(response, label) {
  assert.ok([400, 401, 403, 404].includes(response.status), `${label}: attendu refus, reçu ${response.status} ${response.text}`);
  assert.ok(!response.data?.accessToken, `${label}: aucun jeton ne doit être émis`);
}

async function main() {
  if (!DATABASE_URL) {
    console.log("secTenant01Attachment.http.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const url = await resetIsolatedDatabase();
  const repo = createPostgresRepository(url);
  const pool = new Pool({ connectionString: url });
  const tokens = new TokenService({ secret: JWT_SECRET });
  let child = null;
  let checks = 0;
  const check = () => {
    checks += 1;
  };

  try {
    await repo.init();
    const { schoolA, schoolB, users } = await seed(pool);
    assert.ok(schoolA.login_code && schoolB.login_code, "login_code V2 générés");

    child = spawn(process.execPath, ["backend/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(HTTP_PORT),
        DATABASE_URL: url,
        JWT_SECRET,
        SOMAFRIK_DB_REQUIRED: "true",
        SOMAFRIK_SKIP_DEMO_SEED: "true",
        SOMAFRIK_API_ONLY: "true",
        SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stderrRef = { value: "" };
    child.stderr.on("data", (chunk) => {
      stderrRef.value += String(chunk);
    });
    child.stdout.on("data", () => {});
    await waitForHealth(child, stderrRef);

    // 1. Rattachement principal : Web et Mobile autorisés, données de A uniquement.
    const webA = await webLogin("ST01-ADMIN-A", schoolA.login_code);
    assert.equal(webA.status, 200, `1 web A: ${webA.text}`);
    check();
    const mobileA = await mobileLogin("school_admin", "ST01-ADMIN-A", schoolA.login_code);
    assert.equal(mobileA.status, 200, `1 mobile A: ${mobileA.text}`);
    check();
    const studentsA = await request("/students", { token: webA.data.accessToken });
    assert.equal(studentsA.status, 200, `1 students A: ${studentsA.text}`);
    const studentNames = JSON.stringify(studentsA.data);
    assert.ok(studentNames.includes("Alpha") && !studentNames.includes("Beta"), "1: élèves de A uniquement");
    check();
    const crossA = await request("/students", {
      token: webA.data.accessToken,
      headers: { "X-Somafrik-School-Code": schoolB.login_code },
    });
    assert.equal(crossA.status, 403, `1 sélection B refusée: ${crossA.text}`);
    check();

    // 2. Rôle actif uniquement dans user_roles (users.school_id absent) : fail-closed GP-003.
    assertRefused(await webLogin("ST01-SEC-ROLEONLY", schoolB.login_code), "2 web B");
    check();
    assertRefused(await mobileLogin("secretary", "ST01-SEC-ROLEONLY", schoolB.login_code), "2 mobile B");
    check();
    assertRefused(await mobileLogin("secretary", "ST01-SEC-ROLEONLY", schoolA.login_code), "2 mobile A");
    check();

    // 3. Aucun rattachement : refus Web et Mobile, quel que soit l'établissement saisi.
    for (const school of [schoolA, schoolB]) {
      assertRefused(await webLogin("ST01-DIR-NONE", school.login_code), `3 web ${school.login_code}`);
      assertRefused(await mobileLogin("principal", "ST01-DIR-NONE", school.login_code), `3 mobile ${school.login_code}`);
      check();
    }
    assertRefused(await webLogin("ST01-DIR-NONE"), "3 web sans établissement");
    check();

    // 4. Plusieurs rattachements : établissement principal uniquement.
    const multiA = await webLogin("ST01-MULTI", schoolA.login_code);
    assert.equal(multiA.status, 200, `4 web A: ${multiA.text}`);
    check();
    const multiCross = await request("/students", {
      token: multiA.data.accessToken,
      headers: { "X-Somafrik-School-Code": schoolB.login_code },
    });
    assert.equal(multiCross.status, 403, `4 sélection B refusée: ${multiCross.text}`);
    check();
    assertRefused(await webLogin("ST01-MULTI", schoolB.login_code), "4 web B (non principal)");
    check();

    // Session existante : jeton scolaire "*" émis avant correctif → refus, logout possible.
    const legacySessionId = crypto.randomUUID();
    await repo.createSession({
      sessionId: legacySessionId,
      refreshTokenHash: crypto.randomBytes(32).toString("hex"),
      userId: users.roleOnly,
      schoolCode: "*",
      role: "Secrétaire",
      expiresAt: new Date(Date.now() + 3600_000),
      ipAddress: "127.0.0.1",
      userAgent: "sec-tenant-01",
    });
    const legacyToken = tokens.createAccessToken({
      sub: users.roleOnly,
      role: "Secrétaire",
      roleKeys: ["SECRETARY"],
      schoolCode: "*",
      countryCode: "CD",
      sessionId: legacySessionId,
      permissions: ["ALL_PRIVILEGES"],
      mustChangePassword: false,
    });
    for (const headers of [{}, { "X-Somafrik-School-Code": schoolB.login_code }]) {
      const denied = await request("/students", { token: legacyToken, headers });
      assert.equal(denied.status, 403, `session "*" refusée: ${denied.text}`);
      check();
    }
    const legacyLogout = await request("/auth/logout", { method: "POST", token: legacyToken });
    assert.equal(legacyLogout.status, 200, `logout session "*": ${legacyLogout.text}`);
    check();
    const afterLogout = await request("/auth/effective-permissions", { token: legacyToken });
    assert.equal(afterLogout.status, 401, `session révoquée après logout: ${afterLogout.text}`);
    check();

    // Refresh : rattaché → OK ; après retrait de l'établissement → 401 et session révoquée.
    const fresh = await webLogin("ST01-ADMIN-A", schoolA.login_code);
    assert.equal(fresh.status, 200, `refresh login: ${fresh.text}`);
    const refreshed = await request("/auth/refresh", { method: "POST", body: { refreshToken: fresh.data.refreshToken } });
    assert.equal(refreshed.status, 200, `refresh rattaché: ${refreshed.text}`);
    check();
    await pool.query(`UPDATE users SET school_id = NULL WHERE id = $1`, [users.attached]);
    await pool.query(`UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1`, [users.attached]);
    const refreshedAgain = await request("/auth/refresh", {
      method: "POST",
      body: { refreshToken: refreshed.data.refreshToken },
    });
    assert.equal(refreshedAgain.status, 401, `refresh après retrait: ${refreshedAgain.text}`);
    check();
    const revokedAccess = await request("/auth/effective-permissions", { token: refreshed.data.accessToken });
    assert.equal(revokedAccess.status, 401, `access token de la session révoquée: ${revokedAccess.text}`);
    check();

    // Superadmin : portée plateforme conservée, données personnelles établissement refusées.
    const superLogin = await webLogin("ST01-SUPER");
    assert.equal(superLogin.status, 200, `superadmin login: ${superLogin.text}`);
    check();
    const superStudents = await request("/students", {
      token: superLogin.data.accessToken,
      headers: { "X-Somafrik-School-Code": schoolA.login_code },
    });
    assert.equal(superStudents.status, 403, `superadmin élèves refusés: ${superStudents.text}`);
    check();

    // Multi-rôles plateforme + scolaire : aucun accès implicite aux données scolaires.
    const superTeacherLogin = await webLogin("ST01-SUPER-TEACH", schoolA.login_code);
    if (superTeacherLogin.status === 200) {
      const mixedStudents = await request("/students", { token: superTeacherLogin.data.accessToken });
      assert.equal(mixedStudents.status, 403, `multi-rôles plateforme: élèves refusés: ${mixedStudents.text}`);
    } else {
      assertRefused(superTeacherLogin, "multi-rôles plateforme");
    }
    check();

    console.log(`secTenant01Attachment.http.pg.test.js: ${checks}/${checks} PASS`);
  } finally {
    await stopChild(child);
    await pool.end();
    if (repo.pool?.end) await repo.pool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
