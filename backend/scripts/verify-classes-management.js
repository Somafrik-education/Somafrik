"use strict";

/**
 * Vérification API Classes (mémoire) :
 * Admin School crée / liste / patch ;
 * isolation réelle entre deux établissements (CD + BI) ;
 * PATCH cross-tenant → 404.
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

async function loginSchoolAdmin(schoolCode) {
  const login = await request("/backoffice/login", {
    method: "POST",
    body: { identifier: "admin", password: "1234", schoolCode },
  });
  assert.equal(login.status, 200, `login ${schoolCode} failed: ${JSON.stringify(login.data)}`);
  const token = login.data.accessToken || login.data.token;
  assert.ok(token, `missing access token for ${schoolCode}`);
  return token;
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

    const tokenCd = await loginSchoolAdmin("CD-2026-0001");
    const tokenBi = await loginSchoolAdmin("BI-2026-0002");

    const createdCd = await request("/classes", {
      method: "POST",
      token: tokenCd,
      body: {
        name: `Classe API CD ${Date.now()}`,
        academicYearName: "2025-2026",
        level: "6ème",
        section: "A",
        status: "active",
      },
    });
    assert.equal(createdCd.status, 201, JSON.stringify(createdCd.data));
    assert.match(createdCd.data.classCode, /^CLS-/);
    assert.equal(createdCd.data.status, "active");
    assert.equal(createdCd.data.schoolCode, "CD-2026-0001");

    const createdBi = await request("/classes", {
      method: "POST",
      token: tokenBi,
      body: {
        name: `Classe API BI ${Date.now()}`,
        academicYearName: "2025-2026",
        level: "5ème",
        section: "B",
        status: "active",
      },
    });
    assert.equal(createdBi.status, 201, JSON.stringify(createdBi.data));
    assert.equal(createdBi.data.schoolCode, "BI-2026-0002");

    const listedCd = await request("/classes", { token: tokenCd });
    assert.equal(listedCd.status, 200);
    assert.ok(listedCd.data.some((row) => row.classCode === createdCd.data.classCode));
    assert.ok(!listedCd.data.some((row) => row.classCode === createdBi.data.classCode));

    const listedBi = await request("/classes", { token: tokenBi });
    assert.equal(listedBi.status, 200);
    assert.ok(listedBi.data.some((row) => row.classCode === createdBi.data.classCode));
    assert.ok(!listedBi.data.some((row) => row.classCode === createdCd.data.classCode));

    const patched = await request(`/classes/${encodeURIComponent(createdCd.data.classCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: { name: `${createdCd.data.name} Mod`, status: "inactive" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal(patched.data.status, "inactive");

    const crossPatch = await request(`/classes/${encodeURIComponent(createdCd.data.classCode)}`, {
      method: "PATCH",
      token: tokenBi,
      body: { name: "Tentative fuite" },
    });
    assert.equal(crossPatch.status, 404, JSON.stringify(crossPatch.data));

    const duplicate = await request("/classes", {
      method: "POST",
      token: tokenCd,
      body: {
        name: patched.data.name,
        academicYearName: "2025-2026",
        status: "active",
      },
    });
    assert.equal(duplicate.status, 409, JSON.stringify(duplicate.data));

    const forbiddenStatus = await request("/classes", {
      method: "POST",
      token: tokenCd,
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
