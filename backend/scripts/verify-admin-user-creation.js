"use strict";

/**
 * E2E PostgreSQL — création des comptes administratifs et utilisateurs.
 *
 * Chaîne couverte :
 * 1. Superadmin -> identité -> GRANT Admin Pays -> login.
 * 2. Admin Pays -> identité -> GRANT Admin School -> validation en attente.
 * 3. Superadmin -> identité -> GRANT Admin School actif -> login.
 * 4. Admin School -> identité utilisateur -> GRANT Secrétaire -> GET/reload.
 * 5. PostgreSQL users/user_roles et isolation pays vérifiés directement.
 *
 * Exécution : DATABASE_URL=postgresql://... node backend/scripts/verify-admin-user-creation.js
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { hashSecret } = require("../services/credentialService");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19792;
const DATABASE_NAME = String(process.env.SOMAFRIK_ADMIN_USER_E2E_DATABASE || "somafrik_admin_user_e2e_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const SCHOOL_CD = "CD-2026-0001";
const SCHOOL_BI = "BI-2026-0002";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl) {
  const adminPool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [DATABASE_NAME]);
    if (!existing.rowCount) await adminPool.query(`CREATE DATABASE ${DATABASE_NAME}`);
  } finally {
    await adminPool.end();
  }
  return withDatabaseName(databaseUrl, DATABASE_NAME);
}

async function prepareDatabase(databaseUrl) {
  const isolatedUrl = await ensureDatabase(databaseUrl);
  const pool = new Pool({ connectionString: isolatedUrl });
  const passwordHash = hashSecret("1234");
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(fs.readFileSync(path.join(ROOT, "backend/db/schema.sql"), "utf8"));

    const cd = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const bi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, $2, 'Institut Admin E2E CD', 'active')`,
      [cd.rows[0].id, SCHOOL_CD],
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, $2, 'Institut Admin E2E BI', 'active')`,
      [bi.rows[0].id, SCHOOL_BI],
    );
    await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name, email, password_hash, pin_hash, role, status)
       VALUES (NULL, 'SUPER-ADMIN-E2E', 'Super', 'AdminE2E', 'super-admin-e2e@test.local', $1, $1, 'SUPER_ADMIN', 'active')`,
      [passwordHash],
    );
  } finally {
    await pool.end();
  }
  return isolatedUrl;
}

function baseUrl() {
  return `http://127.0.0.1:${PORT}/api`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function spawnBackend(databaseUrl) {
  return spawn("node", ["backend/server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      DATABASE_URL: databaseUrl,
      JWT_SECRET: process.env.JWT_SECRET || "verify-admin-user-creation-secret-32chars",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early: ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl()}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await wait(300);
  }
  throw new Error("Backend health timeout");
}

async function login(identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, `login ${identifier}: ${JSON.stringify(result.data)}`);
  let token = result.data.accessToken || result.data.token;
  let user = result.data.user;
  if (user?.mustChangePassword) {
    const changed = await request("/auth/change-password", {
      method: "POST",
      token,
      body: { newPassword: password },
    });
    assert.equal(changed.status, 200, `change-password ${identifier}: ${JSON.stringify(changed.data)}`);
    token = changed.data.accessToken || changed.data.token || token;
    user = changed.data.user || user;
  }
  return { token, user };
}

async function createIdentity(token, { firstName, lastName, email, password, schoolCode }) {
  const created = await request("/backoffice/users", {
    method: "POST",
    token,
    body: {
      firstName,
      lastName,
      email,
      temporaryPassword: password,
      ...(schoolCode ? { schoolCode } : {}),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.match(String(created.data.id || ""), /^[0-9a-f-]{36}$/i);
  assert.match(String(created.data.publicId || ""), /^USR-\d{4}-\d{5}$/);
  assert.deepEqual(created.data.roleKeys || [], [], "identité créée sans rôle");
  return created.data;
}

async function grantRole(token, userId, role, expectedKey) {
  const granted = await request(`/backoffice/users/${encodeURIComponent(userId)}/roles/grant`, {
    method: "POST",
    token,
    body: { role },
  });
  assert.equal(granted.status, 200, `${role}: ${JSON.stringify(granted.data)}`);
  assert.ok((granted.data.roleKeys || []).includes(expectedKey), `${role}: roleKey ${expectedKey} absent`);
  return granted.data;
}

async function assertPgRole(pool, userId, roleKey) {
  const result = await pool.query(
    `SELECT u.id, u.school_id, u.role, u.status, u.profile_payload,
            ur.role_key, ur.school_id AS role_school_id, ur.status AS role_status,
            s.school_code, c.iso_code AS country_code
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id AND ur.role_key = $2
       LEFT JOIN schools s ON s.id = u.school_id
       LEFT JOIN countries c ON c.id = s.country_id
      WHERE u.id = $1 AND ur.status = 'active' AND ur.revoked_at IS NULL`,
    [userId, roleKey],
  );
  assert.equal(result.rowCount, 1, `PostgreSQL: rôle ${roleKey} absent pour ${userId}`);
  return result.rows[0];
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  assert.ok(databaseUrl, "DATABASE_URL obligatoire");
  const isolatedUrl = await prepareDatabase(databaseUrl);
  const pool = new Pool({ connectionString: isolatedUrl });
  const child = spawnBackend(isolatedUrl);
  const stamp = Date.now();

  try {
    await waitForHealth(child);
    const superadmin = await login("super-admin-e2e@test.local", "1234");

    // 1) Création Admin Pays par Superadmin.
    const countryEmail = `country-admin-${stamp}@test.local`;
    const countryPassword = "CountryAdmin!2026";
    const countryIdentity = await createIdentity(superadmin.token, {
      firstName: "Amina",
      lastName: `Country${stamp}`,
      email: countryEmail,
      password: countryPassword,
      schoolCode: SCHOOL_CD,
    });
    const countryGranted = await grantRole(superadmin.token, countryIdentity.id, "Admin Pays", "COUNTRY_ADMIN");
    assert.equal(countryGranted.role, "Admin Pays");
    const countryPg = await assertPgRole(pool, countryIdentity.id, "COUNTRY_ADMIN");
    assert.equal(countryPg.school_code, SCHOOL_CD);
    assert.equal(countryPg.country_code, "CD");
    const countryAdmin = await login(countryEmail, countryPassword, SCHOOL_CD);
    assert.ok((countryAdmin.user.roleKeys || []).includes("COUNTRY_ADMIN"), "login Admin Pays sans COUNTRY_ADMIN");

    // Isolation pays : un Admin Pays CD ne peut pas créer dans BI.
    const foreignCreate = await request("/backoffice/users", {
      method: "POST",
      token: countryAdmin.token,
      body: {
        firstName: "Blocked",
        lastName: "Burundi",
        email: `blocked-${stamp}@test.local`,
        schoolCode: SCHOOL_BI,
      },
    });
    assert.equal(foreignCreate.status, 403, JSON.stringify(foreignCreate.data));

    // 2) Admin Pays -> Admin School : création autorisée, validation Superadmin requise.
    const pendingSchoolEmail = `school-admin-pending-${stamp}@test.local`;
    const pendingSchool = await createIdentity(countryAdmin.token, {
      firstName: "Patrick",
      lastName: `SchoolPending${stamp}`,
      email: pendingSchoolEmail,
      password: "SchoolPending!2026",
      schoolCode: SCHOOL_CD,
    });
    const pendingGranted = await grantRole(countryAdmin.token, pendingSchool.id, "Admin School", "SCHOOL_ADMIN");
    assert.equal(pendingGranted.status, "En attente de validation");
    const pendingPg = await assertPgRole(pool, pendingSchool.id, "SCHOOL_ADMIN");
    assert.equal(pendingPg.status, "pending_validation");
    assert.equal(pendingPg.school_code, SCHOOL_CD);
    assert.equal(pendingPg.profile_payload?.validationStatus, "En attente de validation");

    // 3) Superadmin -> Admin School actif, afin de tester ensuite ses mutations utilisateurs.
    const schoolAdminEmail = `school-admin-active-${stamp}@test.local`;
    const schoolAdminPassword = "SchoolAdmin!2026";
    const activeSchoolIdentity = await createIdentity(superadmin.token, {
      firstName: "Grace",
      lastName: `SchoolActive${stamp}`,
      email: schoolAdminEmail,
      password: schoolAdminPassword,
      schoolCode: SCHOOL_CD,
    });
    const activeSchoolGranted = await grantRole(superadmin.token, activeSchoolIdentity.id, "Admin School", "SCHOOL_ADMIN");
    assert.equal(activeSchoolGranted.status, "Actif");
    const activeSchoolPg = await assertPgRole(pool, activeSchoolIdentity.id, "SCHOOL_ADMIN");
    assert.equal(activeSchoolPg.status, "active");
    const schoolAdmin = await login(schoolAdminEmail, schoolAdminPassword, SCHOOL_CD);
    assert.ok((schoolAdmin.user.roleKeys || []).includes("SCHOOL_ADMIN"), "login Admin School sans SCHOOL_ADMIN");

    // 4) Admin School -> utilisateur standard -> GRANT Secrétaire.
    const userEmail = `user-created-${stamp}@test.local`;
    const standardUser = await createIdentity(schoolAdmin.token, {
      firstName: "Nadia",
      lastName: `User${stamp}`,
      email: userEmail,
      password: "StandardUser!2026",
    });
    const userGranted = await grantRole(schoolAdmin.token, standardUser.id, "Secrétaire", "SECRETARY");
    assert.equal(userGranted.role, "Secrétaire");
    const userPg = await assertPgRole(pool, standardUser.id, "SECRETARY");
    assert.equal(userPg.school_code, SCHOOL_CD);
    assert.equal(userPg.status, "active");

    const firstGet = extractList((await request("/backoffice/users", { token: schoolAdmin.token })).data);
    const secondGet = extractList((await request("/backoffice/users", { token: schoolAdmin.token })).data);
    const first = firstGet.find((row) => String(row.id) === String(standardUser.id));
    const second = secondGet.find((row) => String(row.id) === String(standardUser.id));
    assert.ok(first, "GET utilisateurs ne contient pas l'utilisateur créé");
    assert.ok(second, "reload GET utilisateurs perd l'utilisateur créé");
    assert.ok((second.roleKeys || []).includes("SECRETARY"));
    assert.equal(second.schoolCode, SCHOOL_CD);

    // Les trois identités doivent être uniques et relisibles côté PostgreSQL.
    const ids = [countryIdentity.id, activeSchoolIdentity.id, standardUser.id];
    assert.equal(new Set(ids).size, 3, "collision UUID entre comptes créés");
    const count = await pool.query(`SELECT count(*)::int AS c FROM users WHERE id = ANY($1::uuid[])`, [ids]);
    assert.equal(count.rows[0].c, 3, "PostgreSQL: identités créées manquantes");

    console.log("OK verify-admin-user-creation — Admin Pays, Admin School et utilisateur standard créés et persistés");
  } finally {
    child.kill("SIGTERM");
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
