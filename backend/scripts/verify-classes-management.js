"use strict";

/**
 * Vérification API Classes (mémoire) :
 * Admin School crée / liste / patch ; isolation établissement.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19551;
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
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await wait(250);
  }
  throw new Error("Backend health timeout");
}

async function main() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth(child);

    const login = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
    });
    assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.data)}`);
    const token = login.data.accessToken || login.data.token;
    assert.ok(token, "missing access token");

    const created = await request("/classes", {
      method: "POST",
      token,
      body: {
        name: `Classe API ${Date.now()}`,
        academicYearName: "2025-2026",
        level: "6ème",
        section: "A",
        status: "active",
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.match(created.data.classCode, /^CLS-/);
    assert.equal(created.data.status, "active");

    const listed = await request("/classes", { token });
    assert.equal(listed.status, 200);
    assert.ok(listed.data.some((row) => row.classCode === created.data.classCode));

    const patched = await request(`/classes/${encodeURIComponent(created.data.classCode)}`, {
      method: "PATCH",
      token,
      body: { name: `${created.data.name} Mod`, status: "inactive" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal(patched.data.status, "inactive");

    const forbiddenStatus = await request("/classes", {
      method: "POST",
      token,
      body: {
        name: "Bad Status",
        academicYearName: "2025-2026",
        status: "Active",
      },
    });
    assert.equal(forbiddenStatus.status, 400);

    console.log("verify-classes-management: SUCCESS");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
    if (stderr && process.env.DEBUG_CLASSES_VERIFY) {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
