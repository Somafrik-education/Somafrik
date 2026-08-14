"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19699;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  BACKOFFICE_STATE_WRITE_REMOVED_CODE,
  BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
} = require("../lib/backofficeStateRemoval");

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

function runStaticGuards() {
  const patterns = [
    "backend/server.js",
    "web/src/context/DataContext.tsx",
    "Mobile/src/services/api.ts",
    "BackOffice/app.js",
    "backend/db/postgresRepository.js",
    "backend/db/fallbackRepository.js",
  ].map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"));

  const [server, dataContext, mobileApi, backOffice, postgres, fallback] = patterns;

  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.match(server, /overlayResidualProjection/);
  assert.doesNotMatch(dataContext, /api\.put\([\s\S]*\/backoffice\/state/);
  assert.doesNotMatch(mobileApi, /\/backoffice\/state[\s\S]{0,120}method:\s*"PUT"/);
  assert.doesNotMatch(mobileApi, /method:\s*"PUT"[\s\S]{0,120}\/backoffice\/state/);
  assert.doesNotMatch(backOffice, /method:\s*"PUT"[\s\S]{0,120}\/backoffice\/state/);
  assert.match(postgres, /async getBackOfficeState\(\)[\s\S]*return null/);
  assert.match(fallback, /createBackOfficeStateWriteRemovedError/);

  for (const label of ["saveBackOfficeState", "persistSyncedState", "syncBackOfficeState"]) {
    const hits = [];
    for (const rel of ["web/src", "Mobile/src", "BackOffice"]) {
      const dir = path.join(ROOT, rel);
      if (!fs.existsSync(dir)) continue;
      for (const file of walk(dir)) {
        if (!/\.(ts|tsx|js)$/.test(file)) continue;
        const content = fs.readFileSync(file, "utf8");
        if (content.includes(label) && !file.includes("verify-") && !file.includes(".test.")) {
          hits.push(path.relative(ROOT, file));
        }
      }
    }
    if (label === "saveBackOfficeState") {
      const allowed = new Set(["Mobile/src/services/api.ts"]);
      assert.ok(
        hits.every((hit) => allowed.has(hit)),
        `writers résiduels ${label}: ${hits.join(", ")}`,
      );
    }
  }

  console.log("OK static: aucun writer PUT state actif côté clients");
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...walk(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function runHttpGuards() {
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

    const superLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "superadmin@somafrik.app", password: "1234" },
    });
    const superToken = superLogin.data.accessToken || superLogin.data.token;

    const payloads = [{}, null, { academicConfigs: {} }, { exams: [] }, { unknownKey: 1 }, { exams: [], bulletins: [] }];
    for (const body of payloads) {
      const denied = await request("/backoffice/state", {
        method: "PUT",
        token: superToken,
        body,
      });
      assert.equal(denied.status, BACKOFFICE_STATE_WRITE_REMOVED_STATUS, JSON.stringify(body));
      assert.equal(denied.data?.code, BACKOFFICE_STATE_WRITE_REMOVED_CODE);
      assert.equal(denied.data?.message, BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE);
    }

    const getState = await request("/backoffice/state", { token: superToken });
    assert.equal(getState.status, 200);
    assert.ok(Array.isArray(getState.data?.schools));
    assert.ok(!String(JSON.stringify(getState.data)).includes("passwordHash"));

    console.log("OK http: PUT 410 + GET projection read-only");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
  }
}

async function main() {
  runStaticGuards();
  await runHttpGuards();
  console.log("verify-backoffice-state-removal: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
