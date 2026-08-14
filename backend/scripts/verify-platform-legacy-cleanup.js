"use strict";

/**
 * LOT 6 — preuve de clôture Plateforme :
 * - PUT /backoffice/state refuse toute présence d'une clé plateforme avant merge ;
 * - pays / abonnements / notifications / rolePermissions passent par les APIs PostgreSQL ;
 * - aucun writer Web/Mobile/BackOffice ne renvoie les clés plateforme au snapshot.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19684;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  PLATFORM_STATE_KEYS,
  LEGACY_PLATFORM_STATE_WRITE_CODE,
  stripLegacyPlatformStateWrite,
} = require("../lib/legacyPlatformStateWrite");
const { getWritableBackOfficeEntitiesForPrincipal } = require("../lib/backOfficeWritableEntities");
const { assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

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
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}`);
    }
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

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, next < 0 ? source.length : next);
}

function runUnitGuards() {
  for (const role of ["Admin School", "Secrétaire", "Comptable", "Directeur"]) {
    for (const key of PLATFORM_STATE_KEYS) {
      assert.equal(
        getWritableBackOfficeEntitiesForPrincipal({ role }).includes(key),
        false,
        `${role}: ${key} hors matrice PUT`,
      );
    }
  }

  const mixed = stripLegacyPlatformStateWrite({
    countries: [],
    notifications: [{ id: "1" }],
    users: [{ id: "u1" }],
  });
  assert.equal(mixed.rejectLegacyPlatformWrite, true);
  assert.deepEqual(new Set(mixed.rejectedKeys), new Set(["countries", "notifications"]));
  assert.deepEqual(mixed.body, { users: [{ id: "u1" }] });

  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  const postgres = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  const webDataContext = fs.readFileSync(path.join(ROOT, "web/src/context/DataContext.tsx"), "utf8");
  const mobileApi = fs.readFileSync(path.join(ROOT, "Mobile/src/services/api.ts"), "utf8");
  const legacyBackOffice = fs.readFileSync(path.join(ROOT, "BackOffice/app.js"), "utf8");

  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.match(server, /overlayPlatformProjection/);
  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.match(server, /repository\.getRolePermissionsMap/);
  assert.match(server, /requirePermission\("GET \/api\/backoffice\/subscription-access"\)/);
  assert.match(postgres, /ensurePlatformCanonicalSchema/);
  assert.match(postgres, /assertPlatformSchemaPreflight/);
  assert.match(postgres, /countries: _legacyCountries/);
  assert.match(webDataContext, /stripClientPlatformFromPutPayload/);

  const payloadFunction = extractFunction(legacyBackOffice, "getBackOfficeStatePayload");
  assert.ok(payloadFunction, "getBackOfficeStatePayload présent");
  assert.doesNotMatch(payloadFunction, /countries:\s*state\.countries/);
  assert.doesNotMatch(payloadFunction, /subscriptions:\s*state\.subscriptions/);
  assert.doesNotMatch(payloadFunction, /notifications:\s*state\.notifications/);
  assert.doesNotMatch(payloadFunction, /rolePermissions:\s*state\.rolePermissions/);

  for (const key of PLATFORM_STATE_KEYS) {
    assert.doesNotMatch(
      webDataContext,
      new RegExp(`update\\(\\{[^}]*${key}`),
      `web DataContext must not PUT ${key}`,
    );
  }

  assert.doesNotMatch(mobileApi, /persistSyncedState/);
  assert.match(mobileApi, /delete rest\.countries/);
  assert.match(mobileApi, /createPlatformNotification/);
  assert.equal(LEGACY_PLATFORM_STATE_WRITE_CODE, "LEGACY_PLATFORM_STATE_WRITE_FORBIDDEN");

  console.log("OK unit: Plateforme hors PUT state et clients legacy");
}

async function loginAdmin() {
  const login = await request("/backoffice/login", {
    method: "POST",
    body: { identifier: "admin", password: "1234", schoolCode: "CD-2026-0001" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const token = login.data.accessToken || login.data.token;
  assert.ok(token);
  return token;
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
    const token = await loginAdmin();
    const stateBefore = await request("/backoffice/state", { token });
    assert.equal(stateBefore.status, 200, JSON.stringify(stateBefore.data));

    for (const key of PLATFORM_STATE_KEYS) {
      for (const value of [[], {}, null]) {
        const rejected = await request("/backoffice/state", {
          method: "PUT",
          token,
          body: { [key]: value },
        });
        assertBackOfficeStateWriteRemoved(rejected);
}
    }

    const mixed = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: { users: stateBefore.data.users ?? [], notifications: [] },
    });
    assertBackOfficeStateWriteRemoved(mixed);
const stateAfter = await request("/backoffice/state", { token });
    assert.equal(stateAfter.status, 200);
    assert.deepEqual(stateAfter.data.users?.length, stateBefore.data.users?.length);

    console.log("OK http: PUT plateforme fail-closed");
  } finally {
    child.kill("SIGTERM");
  }
}

async function main() {
  runUnitGuards();
  await runHttpGuards();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
