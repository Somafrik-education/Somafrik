"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19772;
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
    body: body ? JSON.stringify(body) : undefined,
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
    if (child.exitCode !== null) throw new Error(`Backend exited ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error("health timeout");
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
    const created = await request("/privacy/erasure-requests", {
      method: "POST",
      body: {
        schoolCode: "CD-2026-0001",
        identifier: "secretaire",
        email: "secretaire@example.com",
        role: "Secrétaire",
        reason: "test P1",
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.status, "pending");
    assert.equal(created.data.identifier, "secretaire");

    const superLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "superadmin", password: "1234" },
    });
    assert.equal(superLogin.status, 200, JSON.stringify(superLogin.data));
    const forbidden = await request("/privacy/erasure-requests", { token: superLogin.data.accessToken });
    assert.equal(forbidden.status, 403, JSON.stringify(forbidden.data));
    const forbiddenExec = await request(`/privacy/erasure-requests/${created.data.id}/execute`, {
      method: "POST",
      token: superLogin.data.accessToken,
    });
    assert.equal(forbiddenExec.status, 403, JSON.stringify(forbiddenExec.data));

    const schoolLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
    });
    assert.equal(schoolLogin.status, 200, JSON.stringify(schoolLogin.data));
    const listed = await request("/privacy/erasure-requests", { token: schoolLogin.data.accessToken });
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    assert.ok(Array.isArray(listed.data));
    assert.ok(listed.data.some((row) => row.id === created.data.id));

    const executed = await request(`/privacy/erasure-requests/${created.data.id}/execute`, {
      method: "POST",
      token: schoolLogin.data.accessToken,
    });
    assert.equal(executed.status, 200, JSON.stringify(executed.data));
    assert.equal(executed.data.request?.status, "processed");
    assert.equal(executed.data.schoolRecordsRetained, true);

    const replay = await request(`/privacy/erasure-requests/${created.data.id}/execute`, {
      method: "POST",
      token: schoolLogin.data.accessToken,
    });
    assert.equal(replay.status, 409, JSON.stringify(replay.data));

    const missing = await request("/privacy/erasure-requests", {
      method: "POST",
      body: { schoolCode: "CD-2026-0001" },
    });
    assert.equal(missing.status, 400, JSON.stringify(missing.data));

    console.log("verify-privacy-erasure: OK");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
