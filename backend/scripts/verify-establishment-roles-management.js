"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const ROOT = require("node:path").resolve(__dirname, "../..");
const PORT = 19721;
const BASE = `http://127.0.0.1:${PORT}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listItems(data) {
  return Array.isArray(data) ? data : data?.items ?? [];
}

async function request(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
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
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.accessToken || result.data.token;
}

async function main() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", SOMAFRIK_DB_REQUIRED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child);
    const superToken = await login("superadmin", "1234");
    const adminToken = await login("admin", "1234", "CD-2026-0001");

    const catalogue = await request("/backoffice/establishment-roles", { token: superToken });
    assert.equal(catalogue.status, 200, JSON.stringify(catalogue.data));
    assert.ok(catalogue.data.roles.some((row) => row.roleName === "Secrétaire"));

    const created = await request("/backoffice/establishment-roles", {
      method: "POST",
      token: superToken,
      body: {
        roleName: "Lot2 Auditeur",
        roleCode: "lot2_auditeur",
        permissions: ["Documents:READ"],
        delegationPermissions: ["Documents:READ"],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const forbiddenPrivileges = await request("/backoffice/establishment-roles", {
      method: "POST",
      token: superToken,
      body: {
        roleName: "Lot2 Privilege",
        roleCode: "lot2_privilege",
        permissions: ["COUNTRY_PRIVILEGES"],
      },
    });
    assert.equal(forbiddenPrivileges.status, 403, JSON.stringify(forbiddenPrivileges.data));

    const adminCreate = await request("/backoffice/establishment-roles", {
      method: "POST",
      token: adminToken,
      body: { roleName: "Interdit", roleCode: "interdit", permissions: ["Classes:READ"] },
    });
    assert.equal(adminCreate.status, 403, JSON.stringify(adminCreate.data));

    const adminPatch = await request(`/backoffice/establishment-roles/${encodeURIComponent(created.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { permissions: ["ALL_PRIVILEGES"] },
    });
    assert.equal(adminPatch.status, 403, JSON.stringify(adminPatch.data));

    const adminReplaceMatrix = await request("/backoffice/role-permissions", {
      method: "PUT",
      token: adminToken,
      body: { Secrétaire: ["ALL_PRIVILEGES"] },
    });
    assert.equal(adminReplaceMatrix.status, 403, JSON.stringify(adminReplaceMatrix.data));

    const assignable = await request("/establishment-roles/assignable", { token: adminToken });
    assert.equal(assignable.status, 200, JSON.stringify(assignable.data));
    assert.ok(assignable.data.roles.some((row) => row.roleName === "Secrétaire"));

    const stamp = Date.now();
    const staffPassword = "Lot2Test!2026";
    const staff = await request("/backoffice/users", {
      method: "POST",
      token: adminToken,
      body: {
        firstName: "Lot2",
        lastName: "Agent",
        role: "Secrétaire",
        email: `lot2-agent-${stamp}@test.local`,
        schoolCode: "CD-2026-0001",
        temporaryPassword: staffPassword,
      },
    });
    assert.equal(staff.status, 201, JSON.stringify(staff.data));

    const assignOk = await request(`/backoffice/users/${encodeURIComponent(staff.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { role: "Comptable" },
    });
    assert.equal(assignOk.status, 200, JSON.stringify(assignOk.data));

    const assignForbidden = await request(`/backoffice/users/${encodeURIComponent(staff.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { role: "Super Administrateur Somafrik" },
    });
    assert.equal(assignForbidden.status, 403, JSON.stringify(assignForbidden.data));

    const assignUnknown = await request(`/backoffice/users/${encodeURIComponent(staff.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { role: "Rôle Inventé Lot2" },
    });
    assert.equal(assignUnknown.status, 404, JSON.stringify(assignUnknown.data));

    const archived = await request(`/backoffice/establishment-roles/${encodeURIComponent(created.data.id)}/archive`, {
      method: "POST",
      token: superToken,
    });
    assert.equal(archived.status, 200, JSON.stringify(archived.data));

    const assignArchived = await request(`/backoffice/users/${encodeURIComponent(staff.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { role: "Lot2 Auditeur" },
    });
    assert.equal(assignArchived.status, 409, JSON.stringify(assignArchived.data));

    const legacyPut = await request("/academic-config", {
      method: "PUT",
      token: adminToken,
      body: { userRoles: ["Secrétaire"] },
    });
    assert.equal(legacyPut.status, 400, JSON.stringify(legacyPut.data));
    assert.equal(legacyPut.data?.code, "LEGACY_USER_ROLES_WRITE_FORBIDDEN");

    const beforeSession = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: staff.data.identifier, password: staffPassword, schoolCode: "CD-2026-0001" },
    });
    assert.equal(beforeSession.status, 200, JSON.stringify(beforeSession.data));
    const beforePermissions = beforeSession.data.permissions ?? [];

    const assignBack = await request(`/backoffice/users/${encodeURIComponent(staff.data.id)}`, {
      method: "PATCH",
      token: adminToken,
      body: { role: "Secrétaire" },
    });
    assert.equal(assignBack.status, 200, JSON.stringify(assignBack.data));

    const afterSession = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: staff.data.identifier, password: staffPassword, schoolCode: "CD-2026-0001" },
    });
    assert.equal(afterSession.status, 200, JSON.stringify(afterSession.data));
    const afterPermissions = afterSession.data.permissions ?? [];
    assert.notDeepEqual(afterPermissions, beforePermissions);

    const effective = await request("/auth/effective-permissions", { token: adminToken });
    assert.equal(effective.status, 200, JSON.stringify(effective.data));
    assert.ok(Array.isArray(effective.data.permissions));

    const usersList = await request("/backoffice/users", { token: adminToken });
    assert.equal(usersList.status, 200);
    assert.ok(listItems(usersList.data).some((row) => row.id === staff.data.id));

    console.log("verify-establishment-roles-management.js OK");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
