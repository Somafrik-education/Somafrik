"use strict";

/**
 * E2E PostgreSQL — création des comptes administratifs et utilisateurs.
 *
 * Chaîne couverte :
 * 0. Superadmin -> POST /users/provision Admin Pays BI + Admin School BI (atomique).
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
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "false",
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
  assert.ok(String(created.data.publicId || "").trim(), "identifiant public serveur absent");
  assert.notEqual(String(created.data.publicId), String(created.data.id), "publicId ne doit pas être le UUID technique");
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
    const schoolCodes = await pool.query(
      `SELECT school_code, login_code FROM schools WHERE school_code IN ($1, $2)`,
      [SCHOOL_CD, SCHOOL_BI],
    );
    const loginByLeftover = new Map(
      schoolCodes.rows.map((row) => [
        String(row.school_code || "").trim().toUpperCase(),
        String(row.login_code || "").trim().toUpperCase(),
      ]),
    );
    const loginCd = loginByLeftover.get(SCHOOL_CD) || "";
    const loginBi = loginByLeftover.get(SCHOOL_BI) || "";
    assert.ok(loginCd && loginCd !== SCHOOL_CD, `login_code CD attendu après boot, reçu ${loginCd}`);
    assert.ok(loginBi && loginBi !== SCHOOL_BI, `login_code BI attendu après boot, reçu ${loginBi}`);
    const superadmin = await login("super-admin-e2e@test.local", "1234");

    // P0 provisioning Superadmin : création directe Admin Pays BI + Admin School BI.
    const provisionPaysEmail = `country-admin-provision-bi-${stamp}@test.local`;
    const provisionPaysPassword = "CountryProvisionBI!2026";
    const provisionPays = await request("/backoffice/users/provision", {
      method: "POST",
      token: superadmin.token,
      body: {
        firstName: "Amina",
        lastName: `PaysBI${stamp}`,
        email: provisionPaysEmail,
        temporaryPassword: provisionPaysPassword,
        roleKey: "COUNTRY_ADMIN",
        countryCode: "BI",
      },
    });
    assert.equal(provisionPays.status, 201, JSON.stringify(provisionPays.data));
    assert.ok((provisionPays.data.roleKeys || []).includes("COUNTRY_ADMIN"));
    const provisionPaysPg = await assertPgRole(pool, provisionPays.data.id, "COUNTRY_ADMIN");
    assert.equal(provisionPaysPg.school_id, null);
    assert.equal(provisionPaysPg.role_school_id, null);
    assert.equal(provisionPaysPg.role_status, "active");
    assert.equal(provisionPaysPg.profile_payload?.countryCode, "BI");
    const provisionPaysLogin = await login(provisionPaysEmail, provisionPaysPassword);
    assert.ok((provisionPaysLogin.user.roleKeys || []).includes("COUNTRY_ADMIN"), "login Admin Pays BI sans COUNTRY_ADMIN");
    assert.equal(provisionPaysLogin.user.countryCode, "BI");

    const provisionSchoolEmail = `school-admin-provision-bi-${stamp}@test.local`;
    const provisionSchoolPassword = "SchoolProvisionBI!2026";
    const provisionSchool = await request("/backoffice/users/provision", {
      method: "POST",
      token: superadmin.token,
      body: {
        firstName: "Grace",
        lastName: `Kanyosha${stamp}`,
        email: provisionSchoolEmail,
        temporaryPassword: provisionSchoolPassword,
        roleKey: "SCHOOL_ADMIN",
        countryCode: "BI",
        schoolCode: SCHOOL_BI,
      },
    });
    assert.equal(provisionSchool.status, 201, JSON.stringify(provisionSchool.data));
    assert.ok((provisionSchool.data.roleKeys || []).includes("SCHOOL_ADMIN"));
    const provisionSchoolPg = await assertPgRole(pool, provisionSchool.data.id, "SCHOOL_ADMIN");
    assert.equal(provisionSchoolPg.school_code, SCHOOL_BI);
    assert.equal(provisionSchoolPg.country_code, "BI");
    assert.equal(String(provisionSchoolPg.school_id), String(provisionSchoolPg.role_school_id));
    const provisionSchoolLogin = await login(provisionSchoolEmail, provisionSchoolPassword, SCHOOL_BI);
    assert.ok((provisionSchoolLogin.user.roleKeys || []).includes("SCHOOL_ADMIN"), "login Admin School BI sans SCHOOL_ADMIN");
    assert.equal(provisionSchoolLogin.user.countryCode, "BI");
    assert.equal(provisionSchoolLogin.user.schoolCode, SCHOOL_BI);

    const orphanEmail = `orphan-provision-${stamp}@test.local`;
    const orphanDenied = await request("/backoffice/users/provision", {
      method: "POST",
      token: superadmin.token,
      body: {
        firstName: "Orphan",
        lastName: `Denied${stamp}`,
        email: orphanEmail,
        temporaryPassword: "OrphanDenied!2026",
        roleKey: "SCHOOL_ADMIN",
        countryCode: "BI",
        schoolCode: SCHOOL_CD,
      },
    });
    assert.equal(orphanDenied.status, 409, JSON.stringify(orphanDenied.data));
    assert.equal(orphanDenied.data.code, "SCHOOL_COUNTRY_MISMATCH");
    const orphanRows = await pool.query(`SELECT id FROM users WHERE email = $1`, [orphanEmail]);
    assert.equal(orphanRows.rowCount, 0, "aucune identité orpheline après échec provision");

    const countryActorDenied = await request("/backoffice/users/provision", {
      method: "POST",
      token: provisionPaysLogin.token,
      body: {
        firstName: "Blocked",
        lastName: `Actor${stamp}`,
        email: `blocked-actor-${stamp}@test.local`,
        temporaryPassword: "BlockedActor!2026",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "BI",
      },
    });
    assert.equal(countryActorDenied.status, 403, JSON.stringify(countryActorDenied.data));

    // 1) Création Admin Pays par Superadmin (GRANT secondaire sur identité existante).
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

    // Contrat P0 : l'identifiant permanent généré par PostgreSQL et affiché par l'API
    // doit être exactement le même alias accepté par le login établissement.
    const identityRow = await pool.query(
      `SELECT identity_code, user_code FROM users WHERE id = $1`,
      [activeSchoolIdentity.id],
    );
    assert.equal(identityRow.rowCount, 1, "PostgreSQL: identité Admin School absente");
    const displayedSchoolAdminId = String(identityRow.rows[0].identity_code || identityRow.rows[0].user_code || "").trim();
    assert.ok(displayedSchoolAdminId, "PostgreSQL: identité permanente Admin School absente");

    const listedSchoolAdmins = extractList((await request("/backoffice/users", { token: superadmin.token })).data);
    const listedSchoolAdmin = listedSchoolAdmins.find((row) => String(row.id) === String(activeSchoolIdentity.id));
    assert.ok(listedSchoolAdmin, "Admin School absent de GET /backoffice/users");
    assert.equal(listedSchoolAdmin.publicId, displayedSchoolAdminId, "GET /backoffice/users diverge de l'identité PostgreSQL");

    const schoolAdmin = await login(displayedSchoolAdminId, schoolAdminPassword, SCHOOL_CD);
    assert.ok((schoolAdmin.user.roleKeys || []).includes("SCHOOL_ADMIN"), "login Admin School par publicId sans SCHOOL_ADMIN");
    const schoolAdminReload = await login(displayedSchoolAdminId, schoolAdminPassword, SCHOOL_CD);
    assert.ok((schoolAdminReload.user.roleKeys || []).includes("SCHOOL_ADMIN"), "relogin Admin School par publicId échoué");

    // P0 tenant : Superadmin crée un Admin School Burundi — jamais rattaché à la RDC.
    const mismatch = await request("/backoffice/users", {
      method: "POST",
      token: superadmin.token,
      body: {
        firstName: "Wrong",
        lastName: `Tenant${stamp}`,
        email: `wrong-tenant-${stamp}@test.local`,
        temporaryPassword: "WrongTenant!2026",
        schoolCode: SCHOOL_CD,
        countryCode: "BI",
      },
    });
    assert.equal(mismatch.status, 409, JSON.stringify(mismatch.data));
    assert.equal(mismatch.data.code, "SCHOOL_COUNTRY_MISMATCH");

    const missingSchoolGrantIdentity = await createIdentity(superadmin.token, {
      firstName: "NoSchool",
      lastName: `Grant${stamp}`,
      email: `noschool-grant-${stamp}@test.local`,
      password: "NoSchoolGrant!2026",
    });
    const missingSchoolGrant = await request(
      `/backoffice/users/${encodeURIComponent(missingSchoolGrantIdentity.id)}/roles/grant`,
      {
        method: "POST",
        token: superadmin.token,
        body: { role: "Admin School" },
      },
    );
    assert.equal(missingSchoolGrant.status, 400, JSON.stringify(missingSchoolGrant.data));
    assert.equal(missingSchoolGrant.data.code, "INVALID_TENANT_SCOPE");

    const biSchoolEmail = `school-admin-bi-${stamp}@test.local`;
    const biSchoolPassword = "SchoolAdminBI!2026";
    const biIdentity = await request("/backoffice/users", {
      method: "POST",
      token: superadmin.token,
      body: {
        firstName: "Diane",
        lastName: `SchoolBI${stamp}`,
        email: biSchoolEmail,
        temporaryPassword: biSchoolPassword,
        schoolCode: SCHOOL_BI,
        countryCode: "BI",
      },
    });
    assert.equal(biIdentity.status, 201, JSON.stringify(biIdentity.data));
    assert.equal(biIdentity.data.schoolCode, loginBi);
    assert.equal(biIdentity.data.countryCode, "BI");
    const biGranted = await grantRole(superadmin.token, biIdentity.data.id, "Admin School", "SCHOOL_ADMIN");
    assert.equal(biGranted.status, "Actif");
    const biPg = await assertPgRole(pool, biIdentity.data.id, "SCHOOL_ADMIN");
    assert.equal(biPg.school_code, SCHOOL_BI);
    assert.equal(biPg.country_code, "BI");
    assert.equal(String(biPg.school_id), String(biPg.role_school_id));
    assert.notEqual(biPg.country_code, "CD");

    const biSchoolAdmin = await login(biSchoolEmail, biSchoolPassword, SCHOOL_BI);
    assert.ok((biSchoolAdmin.user.roleKeys || []).includes("SCHOOL_ADMIN"), "login Admin School BI sans SCHOOL_ADMIN");
    assert.equal(biSchoolAdmin.user.countryCode, "BI");
    assert.equal(biSchoolAdmin.user.schoolCode, SCHOOL_BI);

    const cdDenied = await request(`/backoffice/users/${encodeURIComponent(activeSchoolIdentity.id)}`, {
      method: "PATCH",
      token: biSchoolAdmin.token,
      body: { firstName: "Hacked" },
    });
    assert.equal(cdDenied.status, 403, JSON.stringify(cdDenied.data));

    // P0 réaffectation tenant : SCHOOL_ADMIN CD → BI, compte dédié (ne pas toucher activeSchoolIdentity).
    const reassignEmail = `school-admin-reassign-${stamp}@test.local`;
    const reassignPassword = "SchoolReassign!2026";
    const reassignIdentity = await createIdentity(superadmin.token, {
      firstName: "Irène",
      lastName: `Reassign${stamp}`,
      email: reassignEmail,
      password: reassignPassword,
      schoolCode: SCHOOL_CD,
    });
    await grantRole(superadmin.token, reassignIdentity.id, "Admin School", "SCHOOL_ADMIN");

    const forbiddenIdentityPatch = await request(`/backoffice/users/${encodeURIComponent(reassignIdentity.id)}`, {
      method: "PATCH",
      token: superadmin.token,
      body: {
        firstName: "Irène",
        schoolCode: SCHOOL_BI,
        countryCode: "BI",
        userCode: "SHOULD-BE-FORBIDDEN",
      },
    });
    assert.equal(forbiddenIdentityPatch.status, 400, JSON.stringify(forbiddenIdentityPatch.data));
    assert.equal(forbiddenIdentityPatch.data.code, "CLIENT_IDENTITY_FIELD_FORBIDDEN");

    // Régression #222 : utilisateur PG existant, PATCH identité sans changer le tenant → 200.
    // Contrat UI post-#223 : allowlist (pas de userCode / schoolCode / countryCode / role).
    const identityOnly = await request(`/backoffice/users/${encodeURIComponent(reassignIdentity.id)}`, {
      method: "PATCH",
      token: superadmin.token,
      body: { firstName: "Irène-Edit" },
    });
    assert.equal(identityOnly.status, 200, JSON.stringify(identityOnly.data));
    assert.equal(identityOnly.data.firstName, "Irène-Edit");
    assert.equal(identityOnly.data.schoolCode, loginCd);

    const identityKept = await request(`/backoffice/users/${encodeURIComponent(reassignIdentity.id)}`, {
      method: "PATCH",
      token: superadmin.token,
      body: {
        firstName: "Irène-Maj",
        schoolCode: SCHOOL_BI,
        countryCode: "BI",
      },
    });
    assert.equal(identityKept.status, 200, JSON.stringify(identityKept.data));
    assert.equal(identityKept.data.firstName, "Irène-Maj");
    assert.equal(identityKept.data.schoolCode, loginCd);
    assert.notEqual(identityKept.data.schoolCode, SCHOOL_BI);

    const beforeReassign = await pool.query(
      `SELECT u.id, u.user_code, u.school_id, s.school_code, s.login_code, s.name, c.iso_code,
              ur.school_id AS role_school_id, ur.role_key
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
         LEFT JOIN countries c ON c.id = s.country_id
         JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
        WHERE u.id = $1`,
      [reassignIdentity.id],
    );
    assert.equal(beforeReassign.rows[0].school_code, SCHOOL_CD);
    assert.equal(beforeReassign.rows[0].iso_code, "CD");
    assert.equal(String(beforeReassign.rows[0].school_id), String(beforeReassign.rows[0].role_school_id));

    const loggedReassign = await login(reassignEmail, reassignPassword, SCHOOL_CD);
    const staleToken = loggedReassign.token;

    const mismatchReassign = await request(`/backoffice/users/${encodeURIComponent(reassignIdentity.id)}/reassign-school`, {
      method: "POST",
      token: superadmin.token,
      body: { schoolCode: SCHOOL_BI, countryCode: "CD" },
    });
    assert.equal(mismatchReassign.status, 409, JSON.stringify(mismatchReassign.data));
    assert.equal(mismatchReassign.data.code, "SCHOOL_COUNTRY_MISMATCH");

    const countryDenied = await request(`/backoffice/users/${encodeURIComponent(reassignIdentity.id)}/reassign-school`, {
      method: "POST",
      token: countryAdmin.token,
      body: { schoolCode: SCHOOL_BI, countryCode: "BI" },
    });
    assert.equal(countryDenied.status, 403, JSON.stringify(countryDenied.data));

    const platformDenied = await request(`/backoffice/users/${encodeURIComponent(countryIdentity.id)}/reassign-school`, {
      method: "POST",
      token: superadmin.token,
      body: { schoolCode: SCHOOL_BI, countryCode: "BI" },
    });
    assert.equal(platformDenied.status, 409, JSON.stringify(platformDenied.data));
    assert.equal(platformDenied.data.code, "ROLE_SCOPE_CONFLICT");

    const reassigned = await request(`/backoffice/users/${encodeURIComponent(reassignIdentity.id)}/reassign-school`, {
      method: "POST",
      token: superadmin.token,
      body: { schoolCode: SCHOOL_BI, countryCode: "BI" },
    });
    assert.equal(reassigned.status, 200, JSON.stringify(reassigned.data));
    assert.equal(reassigned.data.schoolCode, loginBi);
    assert.equal(reassigned.data.countryCode, "BI");

    const afterReassign = await pool.query(
      `SELECT u.id, u.user_code, u.school_id, s.school_code, s.login_code, s.name, c.iso_code,
              ur.school_id AS role_school_id, ur.role_key, u.profile_payload
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
         LEFT JOIN countries c ON c.id = s.country_id
         JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active' AND ur.revoked_at IS NULL
        WHERE u.id = $1`,
      [reassignIdentity.id],
    );
    assert.equal(afterReassign.rows[0].school_code, SCHOOL_BI);
    assert.equal(afterReassign.rows[0].iso_code, "BI");
    assert.equal(afterReassign.rows[0].role_key, "SCHOOL_ADMIN");
    assert.equal(String(afterReassign.rows[0].school_id), String(afterReassign.rows[0].role_school_id));
    assert.equal(afterReassign.rows[0].profile_payload?.schoolCode, undefined);
    assert.equal(afterReassign.rows[0].profile_payload?.countryCode, undefined);

    const revokedSessions = await pool.query(
      `SELECT revoke_reason, revoked_at FROM sessions WHERE user_id = $1`,
      [reassignIdentity.id],
    );
    assert.ok(revokedSessions.rowCount > 0, "aucune session à révoquer");
    assert.ok(
      revokedSessions.rows.every((row) => row.revoked_at && row.revoke_reason === "tenant_reassign"),
      JSON.stringify(revokedSessions.rows),
    );

    const staleAccess = await request("/backoffice/users", { token: staleToken });
    assert.equal(staleAccess.status, 401, JSON.stringify(staleAccess.data));

    const newLogin = await login(reassignEmail, reassignPassword, SCHOOL_BI);
    assert.equal(newLogin.user.countryCode, "BI");
    assert.equal(newLogin.user.schoolCode, SCHOOL_BI);

    const oldTenantDenied = await request(`/backoffice/users/${encodeURIComponent(activeSchoolIdentity.id)}`, {
      method: "PATCH",
      token: newLogin.token,
      body: { firstName: "Hacked" },
    });
    assert.equal(oldTenantDenied.status, 403, JSON.stringify(oldTenantDenied.data));

    const selfReassignForbidden = await request(
      `/backoffice/users/${encodeURIComponent(reassignIdentity.id)}/reassign-school`,
      {
        method: "POST",
        token: newLogin.token,
        body: { schoolCode: SCHOOL_CD, countryCode: "CD" },
      },
    );
    assert.equal(selfReassignForbidden.status, 403, JSON.stringify(selfReassignForbidden.data));
    assert.equal(selfReassignForbidden.data.code, "USER_TENANT_REASSIGN_FORBIDDEN");

    // P0 reset password : verrouiller volontairement le compte, puis exiger un reset qui
    // déverrouille immédiatement, révoque les sessions et impose le changement du secret.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request("/backoffice/login", {
        method: "POST",
        body: { identifier: displayedSchoolAdminId, password: "WrongPassword!2026", schoolCode: SCHOOL_CD },
      });
      assert.equal(failed.status, 401, `échec login ${attempt + 1}: ${JSON.stringify(failed.data)}`);
    }
    const locked = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: displayedSchoolAdminId, password: schoolAdminPassword, schoolCode: SCHOOL_CD },
    });
    assert.equal(locked.status, 423, `compte non verrouillé après 5 échecs: ${JSON.stringify(locked.data)}`);

    const resetTemporaryPassword = "ResetSchool!2026";
    const reset = await request(`/users/${encodeURIComponent(activeSchoolIdentity.id)}/reset-password`, {
      method: "POST",
      token: superadmin.token,
      body: { temporaryPassword: resetTemporaryPassword },
    });
    assert.equal(reset.status, 200, `reset password: ${JSON.stringify(reset.data)}`);
    assert.equal(reset.data.temporaryPassword, resetTemporaryPassword);
    assert.equal(reset.data.user?.mustChangePassword, true, "mustChangePassword absent après reset");

    const immediate = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: displayedSchoolAdminId, password: resetTemporaryPassword, schoolCode: SCHOOL_CD },
    });
    assert.equal(immediate.status, 200, `login immédiat après reset: ${JSON.stringify(immediate.data)}`);
    assert.equal(immediate.data.user?.mustChangePassword, true, "login reset doit imposer changement mot de passe");

    const resetToken = immediate.data.accessToken || immediate.data.token;
    const finalPassword = "SchoolAdminFinal!2026";
    const changedAfterReset = await request("/auth/change-password", {
      method: "POST",
      token: resetToken,
      body: { newPassword: finalPassword },
    });
    assert.equal(changedAfterReset.status, 200, `change-password après reset: ${JSON.stringify(changedAfterReset.data)}`);
    const finalLogin = await login(displayedSchoolAdminId, finalPassword, SCHOOL_CD);
    assert.ok((finalLogin.user.roleKeys || []).includes("SCHOOL_ADMIN"), "relogin final après reset échoué");

    // 4) Admin School -> utilisateur standard -> GRANT Secrétaire.
    // schoolAdmin.token a été émis avant le reset : la session est révoquée (fail-closed).
    const schoolAdminLiveToken = finalLogin.token;
    const userEmail = `user-created-${stamp}@test.local`;
    const standardUser = await createIdentity(schoolAdminLiveToken, {
      firstName: "Nadia",
      lastName: `User${stamp}`,
      email: userEmail,
      password: "StandardUser!2026",
    });
    const userGranted = await grantRole(schoolAdminLiveToken, standardUser.id, "Secrétaire", "SECRETARY");
    assert.equal(userGranted.role, "Secrétaire");
    const userPg = await assertPgRole(pool, standardUser.id, "SECRETARY");
    assert.equal(userPg.school_code, SCHOOL_CD);
    assert.equal(userPg.status, "active");

    const firstGet = extractList((await request("/backoffice/users", { token: schoolAdminLiveToken })).data);
    const secondGet = extractList((await request("/backoffice/users", { token: schoolAdminLiveToken })).data);
    const first = firstGet.find((row) => String(row.id) === String(standardUser.id));
    const second = secondGet.find((row) => String(row.id) === String(standardUser.id));
    assert.ok(first, "GET utilisateurs ne contient pas l'utilisateur créé");
    assert.ok(second, "reload GET utilisateurs perd l'utilisateur créé");
    assert.ok((second.roleKeys || []).includes("SECRETARY"));
    assert.equal(second.schoolCode, loginCd);

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
