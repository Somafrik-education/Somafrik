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
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      DATABASE_URL: "",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
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
      assert.equal(legacy.status, 400, key);
      assert.equal(legacy.data?.code, "LEGACY_CLIENTS_STATE_WRITE_FORBIDDEN", key);
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
        role: "Secrétaire",
        email: "lot7-agent@test.local",
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(user.status, 201, JSON.stringify(user.data));
    assert.equal(collectSensitiveUserFieldPaths(user.data).length, 0);

    const announcement = await request("/backoffice/announcements", {
      method: "POST",
      token: schoolToken,
      body: {
        title: "Annonce LOT7",
        message: "Test",
        audience: "Parents",
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(announcement.status, 201, JSON.stringify(announcement.data));

    const state = await request("/backoffice/state", { token: schoolToken });
    assert.equal(state.status, 200);
    assert.ok(Array.isArray(state.data.contacts));
    assert.ok(state.data.contacts.some((row) => row.phone === "+243900111222"));

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

    const staffPassword = "E2eStaff!2026";
    const staff = await request("/backoffice/users", {
      method: "POST",
      token: schoolToken,
      body: {
        firstName: "Self",
        lastName: "Patch",
        role: "Secrétaire",
        email: `self-patch-${Date.now()}@test.local`,
        schoolCode: "CD-2026-0001",
        temporaryPassword: staffPassword,
      },
    });
    assert.equal(staff.status, 201, JSON.stringify(staff.data));
    const staffToken = await login(staff.data.identifier, staffPassword, "CD-2026-0001");
    const beforeLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: staff.data.identifier, password: staffPassword, schoolCode: "CD-2026-0001" },
    });
    assert.equal(beforeLogin.status, 200);
    const beforePermissions = [
      ...(beforeLogin.data.permissions ?? []),
      ...(beforeLogin.data.user?.permissions ?? []),
      ...decodeJwtPayload(beforeLogin.data.accessToken).permissions ?? [],
    ];

    const forbiddenPatch = await request(`/backoffice/users/${encodeURIComponent(staff.data.id)}`, {
      method: "PATCH",
      token: staffToken,
      body: { profile: { permissions: ["ALL_PRIVILEGES"] } },
    });
    assert.equal(forbiddenPatch.status, 403, JSON.stringify(forbiddenPatch.data));

    const afterLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: staff.data.identifier, password: staffPassword, schoolCode: "CD-2026-0001" },
    });
    assert.equal(afterLogin.status, 200);
    const afterPermissions = [
      ...(afterLogin.data.permissions ?? []),
      ...(afterLogin.data.user?.permissions ?? []),
      ...decodeJwtPayload(afterLogin.data.accessToken).permissions ?? [],
    ];
    assert.equal(afterPermissions.includes("ALL_PRIVILEGES"), false, "JWT sans ALL_PRIVILEGES");
    assert.deepEqual(afterPermissions.sort(), beforePermissions.sort(), "permissions inchangées après rejet");

    const usersAfter = await request("/backoffice/users", { token: schoolToken });
    assert.equal(usersAfter.status, 200);
    const projectedStaff = (Array.isArray(usersAfter.data) ? usersAfter.data : usersAfter.data?.items ?? []).find(
      (row) => row.id === staff.data.id,
    );
    assert.ok(projectedStaff, "utilisateur toujours projeté");
    assert.equal(projectedStaff.permissions?.includes("ALL_PRIVILEGES"), false, "projection sans ALL_PRIVILEGES");

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
