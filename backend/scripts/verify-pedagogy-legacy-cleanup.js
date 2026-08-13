"use strict";

/**
 * LOT 5 — preuve de clôture Pédagogie :
 * - PUT /backoffice/state refuse toute présence d'une clé pédagogique avant merge ;
 * - cours / emplois du temps / évaluations / notes / présences passent par les APIs PostgreSQL ;
 * - state pédagogie est une projection de lecture ;
 * - aucun writer Web/Mobile/BackOffice ne renvoie les clés pédagogiques au snapshot.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19675;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  PEDAGOGY_STATE_KEYS,
  LEGACY_PEDAGOGY_STATE_WRITE_CODE,
  LEGACY_PEDAGOGY_STATE_WRITE_MESSAGE,
  stripLegacyPedagogyStateWrite,
} = require("../lib/legacyPedagogyStateWrite");
const {
  evaluateBackOfficeWriteAccess,
  getWritableBackOfficeEntitiesForPrincipal,
} = require("../lib/backOfficeWritableEntities");

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

function extractRoute(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const next = source.indexOf("\napp.", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function runUnitGuards() {
  for (const role of ["Admin School", "Secrétaire", "Comptable", "Directeur", "Préfet des études"]) {
    for (const key of PEDAGOGY_STATE_KEYS) {
      assert.equal(
        getWritableBackOfficeEntitiesForPrincipal({ role }).includes(key),
        false,
        `${role}: ${key} hors matrice PUT`,
      );
    }
  }
  assert.equal(
    getWritableBackOfficeEntitiesForPrincipal(
      { role: "Super Administrateur Somafrik" },
      [...PEDAGOGY_STATE_KEYS, "users", "auditLog"],
    ).includes("notes"),
    false,
  );

  const mixed = stripLegacyPedagogyStateWrite({
    users: [{ id: "u1" }],
    notes: [],
    evaluations: null,
    courses: {},
  });
  assert.equal(mixed.rejectLegacyPedagogyWrite, true);
  assert.deepEqual(mixed.rejectedKeys, ["courses", "evaluations", "notes"]);

  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert.match(server, /overlayPedagogyProjection/);
  assert.match(server, /stripLegacyPedagogyStateWrite/);
  assert.match(server, /LEGACY_PEDAGOGY_STATE_WRITE_CODE/);
  assert.doesNotMatch(
    extractRoute(server, 'app.put("/api/backoffice/state"'),
    /syncNotesDomainFromBackOffice/,
  );

  const postgres = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  const saveState = postgres.match(/async saveBackOfficeState\(payload\) \{[\s\S]*?\n  \}\n\n  async getAcademicConfig/);
  assert.ok(saveState, "saveBackOfficeState PostgreSQL présent");
  assert.match(saveState[0], /_legacyNotes/);
  assert.doesNotMatch(saveState[0], /syncNotesDomainFromBackOffice/);

  const webContext = fs.readFileSync(path.join(ROOT, "web/src/context/DataContext.tsx"), "utf8");
  assert.match(webContext, /stripClientPedagogyFromPutPayload/);

  const legacyBackOffice = fs.readFileSync(path.join(ROOT, "BackOffice/app.js"), "utf8");
  const payloadFunction = legacyBackOffice.slice(
    legacyBackOffice.indexOf("function getBackOfficeStatePayload"),
    legacyBackOffice.indexOf("function scheduleBackOfficeSync"),
  );
  assert.doesNotMatch(payloadFunction, /courses:\s*state\.courses/);
  assert.doesNotMatch(payloadFunction, /notes:\s*state\.notes/);
  assert.doesNotMatch(payloadFunction, /presences:\s*state\.presences/);

  console.log("OK unit: Pédagogie hors PUT state et clients legacy");
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
  const env = {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "development",
    SOMAFRIK_DB_REQUIRED: "false",
    // Force le mode mémoire : éviter l'init PG partiel (login seed absent en base locale).
    DATABASE_URL: "",
  };
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth(child);
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early (${child.exitCode}): ${stderr}`);
    }
    const token = await loginAdmin();
    const stateBefore = await request("/backoffice/state", { token });
    assert.equal(stateBefore.status, 200, JSON.stringify(stateBefore.data));

    for (const key of PEDAGOGY_STATE_KEYS) {
      for (const value of [[], {}, null]) {
        const rejected = await request("/backoffice/state", {
          method: "PUT",
          token,
          body: { [key]: value },
        });
        assert.equal(rejected.status, 400, `${key}=${String(value)}: ${JSON.stringify(rejected.data)}`);
        assert.equal(rejected.data?.code, LEGACY_PEDAGOGY_STATE_WRITE_CODE);
        assert.deepEqual(rejected.data?.details?.rejectedKeys, [key]);
      }
    }

    const mixed = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: { users: stateBefore.data.users ?? [], notes: [] },
    });
    assert.equal(mixed.status, 400);
    assert.equal(mixed.data?.code, LEGACY_PEDAGOGY_STATE_WRITE_CODE);
    assert.deepEqual(mixed.data?.details?.rejectedKeys, ["notes"]);

    const stateAfter = await request("/backoffice/state", { token });
    assert.equal(stateAfter.status, 200);
    assert.deepEqual(stateAfter.data.users?.length, stateBefore.data.users?.length);

    console.log("OK http: PUT pédagogie fail-closed");
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
