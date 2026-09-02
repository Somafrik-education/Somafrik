"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19686;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  CLIENTS_STATE_KEYS,
  LEGACY_CLIENTS_STATE_WRITE_CODE,
  stripLegacyClientsStateWrite,
} = require("../lib/legacyClientsStateWrite");
const { getWritableBackOfficeEntitiesForPrincipal } = require("../lib/backOfficeWritableEntities");
const { assertBackOfficeStateReadRemoved, assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

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

function runUnitGuards() {
  for (const role of ["Admin School", "Secrétaire", "Directeur", "Admin Pays"]) {
    for (const key of CLIENTS_STATE_KEYS) {
      assert.equal(
        getWritableBackOfficeEntitiesForPrincipal({ role }).includes(key),
        false,
        `${role}: ${key} hors matrice PUT`,
      );
    }
  }

  const rejected = stripLegacyClientsStateWrite({ users: [], classes: [] });
  assert.equal(rejected.rejectLegacyClientsWrite, true);
  assert.equal(rejected.rejectedKeys[0], "users");

  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const postgres = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  const dataContext = fs.readFileSync(path.join(ROOT, "web/src/context/DataContext.tsx"), "utf8");
  const mobileApi = fs.readFileSync(path.join(ROOT, "Mobile/src/services/api.ts"), "utf8");
  const backOffice = fs.readFileSync(path.join(ROOT, "BackOffice/app.js"), "utf8");

  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.match(server, /overlayClientsProjection/);
  assert.match(server, /listClientsProjection/);
  assert.match(postgres, /ensureClientsCanonicalSchema/);
  assert.match(dataContext, /stripClientClientsFromPutPayload/);
  assert.match(mobileApi, /BACKOFFICE_STATE_WRITE_REMOVED/);
  assert.doesNotMatch(backOffice, /\/backoffice\/state/);

  console.log("OK unit: Clients hors PUT state et clients legacy");
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
    const login = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "superadmin", password: "1234" },
    });
    const token = login.data.accessToken || login.data.token;

    const denied = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: { contacts: [{ id: "x" }], users: [] },
    });
    assertBackOfficeStateWriteRemoved(denied);
    assertBackOfficeStateReadRemoved(await request("/backoffice/state", { token }));

    console.log("OK http: PUT/GET clients fail-closed");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
  }
}

async function main() {
  runUnitGuards();
  await runHttpGuards();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
