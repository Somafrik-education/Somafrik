"use strict";

/**
 * LOT 7 — parcours Clients HTTP (mémoire).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { collectSensitiveUserFieldPaths } = require("../lib/sanitizeUserForResponse");

function decodeJwtPayload(token) {
  const segment = String(token ?? "").split(".")[1];
  if (!segment) return {};
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

const ROOT = require("node:path").resolve(__dirname, "../..");
const { assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");
const PORT = 19685;
const BASE = `http://127.0.0.1:${PORT}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { method = "GET", token, body, headers } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
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

async function waitForHealth(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Backend exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

async function login(identifier, password, schoolCode) {
  const session = await loginSession(identifier, password, schoolCode);
  return session.accessToken;
}

async function loginSession(identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  let token = result.data.accessToken || result.data.token;
  let session = result.data;
  if (
    (session?.user?.mustChangePassword || session?.mustChangePassword) &&
    String(password).length >= 8
  ) {
    const changed = await request("/auth/change-password", {
      method: "POST",
      token,
      body: { newPassword: password },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    token = changed.data.accessToken || changed.data.token || token;
    session = { ...session, ...changed.data, accessToken: token };
  }
  return session;
}

function jwtPermissions(token) {
  return [...new Set(decodeJwtPayload(token).permissions ?? [])];
}

async function main() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      DATABASE_URL: "",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child);
    const superToken = await login("superadmin", "1234");
    const schoolToken = await login("admin", "1234", "CD-2026-0001");

    for (const key of ["users", "contacts", "relations", "messages", "announcements"]) {
      const legacy = await request("/backoffice/state", {
        method: "PUT",
        token: superToken,
        body: { [key]: [] },
      });
      assertBackOfficeStateWriteRemoved(legacy);
}

    const contact = await request("/backoffice/contacts", {
      method: "POST",
      token: schoolToken,
      body: {
        firstName: "Claudine",
        lastName: "Lot7",
        contactType: "Parent",
        phone: "+243900111222",
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(contact.status, 201, JSON.stringify(contact.data));

    const user = await request("/backoffice/users", {
      method: "POST",
      token: schoolToken,
      body: {
        firstName: "Agent",
        lastName: "Test",
        email: "lot7-agent@test.local",
      },
    });
    assert.equal(user.status, 201, JSON.stringify(user.data));
    assert.equal(collectSensitiveUserFieldPaths(user.data).length, 0);

    const publisherPassword = "E2eAnnPublisher!2026";
    const publisher = await request("/backoffice/users", {
      method: "POST",
      token: schoolToken,
      body: {
        firstName: "Publisher",
        lastName: "Annonce",
        email: "lot7-announcement-publisher@test.local",
        temporaryPassword: publisherPassword,
      },
    });
    assert.equal(publisher.status, 201, JSON.stringify(publisher.data));
    assert.ok(publisher.data.id, "publisher id canonique");
    const grantPublisher = await request(`/backoffice/users/${encodeURIComponent(publisher.data.id)}/roles/grant`, {
      method: "POST",
      token: superToken,
      body: { role: "Admin School" },
    });
    assert.equal(grantPublisher.status, 200, JSON.stringify(grantPublisher.data));
    const publisherSession = await loginSession(
      publisher.data.identifier,
      publisherPassword,
      "CD-2026-0001",
    );
    assert.equal(
      decodeJwtPayload(publisherSession.accessToken).sub,
      publisher.data.id,
      "JWT sub = users.id canonique",
    );
    assert.equal(decodeJwtPayload(publisherSession.accessToken).schoolCode, "CD-2026-0001");

    const announcement = await request("/backoffice/announcements", {
      method: "POST",
      token: publisherSession.accessToken,
      body: {
        title: "Annonce LOT7",
        message: "Test",
        audience: "Parents",
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(announcement.status, 201, JSON.stringify(announcement.data));

    const contactsList = await request("/backoffice/contacts", { token: schoolToken });
    assert.equal(contactsList.status, 200);
    assert.ok(Array.isArray(contactsList.data));
    assert.ok(contactsList.data.some((row) => row.phone === "+243900111222"));

    const countryAdminToken = await login("admin-rdc", "1234");
    const crossTenant = await request("/backoffice/contacts", {
      method: "POST",
      token: countryAdminToken,
      body: {
        firstName: "Hack",
        lastName: "Body",
        contactType: "Parent",
        phone: "+243900111333",
        schoolCode: "BI-2026-0002",
      },
    });
    assert.equal(crossTenant.status, 403, JSON.stringify(crossTenant.data));

    // -------------------------------------------------------------------------
    // P0 HTTP — escalade profile.permissions (acteur Admin School autorisé RBAC)
    // Le PATCH principal utilise ownToken (second Admin School), jamais staffToken.
    // -------------------------------------------------------------------------
    const adminSchoolPassword = "E2eAdminSchool!2026";
    const stamp = Date.now();
    const secondAdmin = await request("/backoffice/users", {
      method: "POST",
      token: schoolToken,
      body: {
        firstName: "Second",
        lastName: "Admin",
        email: `admin-school-${stamp}@test.local`,
        temporaryPassword: adminSchoolPassword,
      },
    });
    assert.equal(secondAdmin.status, 201, JSON.stringify(secondAdmin.data));
    const grantAdmin = await request(`/backoffice/users/${encodeURIComponent(secondAdmin.data.id)}/roles/grant`, {
      method: "POST",
      token: superToken,
      body: { role: "Admin School" },
    });
    assert.equal(grantAdmin.status, 200, JSON.stringify(grantAdmin.data));

    const beforeSession = await loginSession(
      secondAdmin.data.identifier,
      adminSchoolPassword,
      "CD-2026-0001",
    );
    const adminSchoolOwnToken = beforeSession.accessToken;
    const beforeJwtPermissions = jwtPermissions(adminSchoolOwnToken);

    const usersBefore = await request("/backoffice/users", { token: schoolToken });
    assert.equal(usersBefore.status, 200);
    const projectedBefore = (Array.isArray(usersBefore.data) ? usersBefore.data : usersBefore.data?.items ?? []).find(
      (row) => row.id === secondAdmin.data.id,
    );
    assert.ok(projectedBefore, "admin secondaire projeté avant PATCH");

    const forbiddenPatch = await request(`/backoffice/users/${encodeURIComponent(secondAdmin.data.id)}`, {
      method: "PATCH",
      token: adminSchoolOwnToken,
      body: { profile: { permissions: ["ALL_PRIVILEGES"] } },
    });
    assert.equal(forbiddenPatch.status, 403, JSON.stringify(forbiddenPatch.data));
    assert.equal(
      forbiddenPatch.data?.code,
      "FORBIDDEN",
      "Admin School (Gérer utilisateurs) : rejet métier assertSafeUserProfilePatch",
    );

    const afterSession = await loginSession(
      secondAdmin.data.identifier,
      adminSchoolPassword,
      "CD-2026-0001",
    );
    const afterJwtPermissions = jwtPermissions(afterSession.accessToken);
    assert.equal(afterJwtPermissions.includes("ALL_PRIVILEGES"), false, "JWT sans ALL_PRIVILEGES");
    assert.deepEqual(afterJwtPermissions.sort(), beforeJwtPermissions.sort(), "JWT inchangé après rejet");

    const usersAfter = await request("/backoffice/users", { token: schoolToken });
    assert.equal(usersAfter.status, 200);
    const projectedAfter = (Array.isArray(usersAfter.data) ? usersAfter.data : usersAfter.data?.items ?? []).find(
      (row) => row.id === secondAdmin.data.id,
    );
    assert.ok(projectedAfter, "admin secondaire toujours projeté");
    assert.equal(projectedAfter.permissions?.includes("ALL_PRIVILEGES"), false, "projection sans ALL_PRIVILEGES");
    assert.equal(projectedAfter.firstName, projectedBefore.firstName, "projection inchangée (zéro mutation)");
    assert.equal(projectedAfter.schoolCode, projectedBefore.schoolCode, "projection schoolCode inchangée");
    assert.equal(projectedAfter.schoolCode, "CD-IN-26-001", "Users API schoolCode = login_code");
    assert.notEqual(projectedAfter.schoolCode, "CD-2026-0001", "Users API n'émet plus leftover JWT");
    assert.equal(
      decodeJwtPayload(adminSchoolOwnToken).schoolCode,
      "CD-2026-0001",
      "JWT schoolCode reste l'alias historique",
    );
    assert.equal(
      decodeJwtPayload(adminSchoolOwnToken).schoolPublicCode,
      undefined,
      "JWT ne transporte pas schoolPublicCode",
    );

    console.log("verify-clients-management.js OK");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
