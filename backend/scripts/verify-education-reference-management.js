"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const ROOT = require("node:path").resolve(__dirname, "../..");
const PORT = 19720;
const BASE = `http://127.0.0.1:${PORT}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const countryAdminToken = await login("admin-rdc", "1234");

    const createdLevel = await request("/backoffice/education-levels", {
      method: "POST",
      token: superToken,
      body: { countryCode: "CD", name: "Lot1 Niveau", code: "lot1_niveau" },
    });
    assert.equal(createdLevel.status, 201, JSON.stringify(createdLevel.data));

    const createdStream = await request("/backoffice/education-streams", {
      method: "POST",
      token: superToken,
      body: { countryCode: "CD", name: "Lot1 Filière", code: "lot1_filiere", streamType: "filiere" },
    });
    assert.equal(createdStream.status, 201, JSON.stringify(createdStream.data));

    const createdGroup = await request("/backoffice/education-class-groups", {
      method: "POST",
      token: superToken,
      body: { countryCode: "CD", code: "A", name: "A" },
    });
    assert.equal(createdGroup.status, 201, JSON.stringify(createdGroup.data));

    const adminCreateLevel = await request("/backoffice/education-levels", {
      method: "POST",
      token: adminToken,
      body: { countryCode: "CD", name: "Interdit", code: "interdit" },
    });
    assert.equal(adminCreateLevel.status, 403, JSON.stringify(adminCreateLevel.data));

    const adminCreateGroup = await request("/backoffice/education-class-groups", {
      method: "POST",
      token: adminToken,
      body: { countryCode: "CD", code: "Z", name: "Z" },
    });
    assert.equal(adminCreateGroup.status, 403, JSON.stringify(adminCreateGroup.data));

    const activation = await request("/education-reference/school-activation", {
      method: "PUT",
      token: adminToken,
      body: { levelIds: [createdLevel.data.id], streamIds: [createdStream.data.id], groupIds: [createdGroup.data.id] },
    });
    assert.equal(activation.status, 200, JSON.stringify(activation.data));

    const countryAdminActivation = await request("/education-reference/school-activation", {
      method: "PUT",
      token: countryAdminToken,
      body: { levelIds: [createdLevel.data.id], streamIds: [createdStream.data.id] },
    });
    assert.equal(countryAdminActivation.status, 403, JSON.stringify(countryAdminActivation.data));

    const countryReadOwn = await request("/backoffice/education-levels?countryCode=CD", {
      token: countryAdminToken,
    });
    assert.equal(countryReadOwn.status, 200, JSON.stringify(countryReadOwn.data));
    assert.ok(Array.isArray(countryReadOwn.data.levels));

    const countryReadForeign = await request("/backoffice/education-levels?countryCode=BI", {
      token: countryAdminToken,
    });
    assert.equal(countryReadForeign.status, 403, JSON.stringify(countryReadForeign.data));
    assert.equal(countryReadForeign.data?.code, "COUNTRY_MISMATCH");

    const legacyPut = await request("/academic-config", {
      method: "PUT",
      token: adminToken,
      body: { levels: ["legacy"] },
    });
    assert.equal(legacyPut.status, 400, JSON.stringify(legacyPut.data));
    assert.equal(legacyPut.data?.code, "LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN");

    const legacyNull = await request("/academic-config", {
      method: "PUT",
      token: adminToken,
      body: { tracks: null, periods: [] },
    });
    assert.equal(legacyNull.status, 400, JSON.stringify(legacyNull.data));

    console.log("verify-education-reference-management.js OK");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
