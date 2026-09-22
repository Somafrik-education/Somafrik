"use strict";

/**
 * PARITY-037 — preuve HTTP : contrat canonique === alias, 403 hors scope, Deprecation.
 *   node --test backend/lib/educationSchoolCatalog.http.test.js
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.SOMAFRIK_LOT1_CATALOG_HTTP_PORT ?? 19731);
const BASE = `http://127.0.0.1:${PORT}/api`;
const SCHOOL_A = "CD-2026-0001";
const SCHOOL_B = "BI-2026-0002";

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
  return {
    status: response.status,
    data,
    deprecation: response.headers.get("deprecation"),
    link: response.headers.get("link"),
  };
}

async function waitForHealth(child, stderrRef) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Backend exited early with code ${child.exitCode}\n${stderrRef.value}`);
    }
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await wait(250);
  }
  throw new Error(`Backend health timeout\n${stderrRef.value}`);
}

async function login(identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.accessToken || result.data.token;
}

test("PARITY-037 HTTP canonique et alias partagent le DTO, 403 hors scope, Deprecation", { timeout: 60_000 }, async () => {
  const stderrRef = { value: "" };
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
  child.stderr.on("data", (chunk) => {
    stderrRef.value += String(chunk);
  });
  try {
    await waitForHealth(child, stderrRef);
    const superToken = await login("superadmin", "1234");
    const tokenA = await login("admin", "1234", SCHOOL_A);
    const tokenB = await login("admin", "1234", SCHOOL_B);

    const suffix = `lot1_${Date.now()}`;
    const createdLevel = await request("/backoffice/education-levels", {
      method: "POST",
      token: superToken,
      body: { countryCode: "CD", name: `Niveau ${suffix}`, code: suffix },
    });
    assert.equal(createdLevel.status, 201, JSON.stringify(createdLevel.data));
    const createdStream = await request("/backoffice/education-streams", {
      method: "POST",
      token: superToken,
      body: { countryCode: "CD", name: `Filiere ${suffix}`, code: `${suffix}_f`, streamType: "filiere" },
    });
    assert.equal(createdStream.status, 201, JSON.stringify(createdStream.data));
    const createdGroup = await request("/backoffice/education-class-groups", {
      method: "POST",
      token: superToken,
      body: { countryCode: "CD", code: suffix.slice(-8).toUpperCase(), name: `Groupe ${suffix}` },
    });
    assert.equal(createdGroup.status, 201, JSON.stringify(createdGroup.data));

    const activationBody = {
      levelIds: [createdLevel.data.id],
      streamIds: [createdStream.data.id],
      groupIds: [createdGroup.data.id],
    };
    const putCanonical = await request(
      `/education-reference/school-activation?schoolCode=${encodeURIComponent(SCHOOL_A)}`,
      { method: "PUT", token: tokenA, body: activationBody },
    );
    assert.equal(putCanonical.status, 200, JSON.stringify(putCanonical.data));
    assert.equal(putCanonical.data.schoolCode, SCHOOL_A);

    const getCanonical = await request(
      `/education-reference/catalog?schoolCode=${encodeURIComponent(SCHOOL_A)}`,
      { token: tokenA },
    );
    const getAlias = await request(
      `/backoffice/establishments/${encodeURIComponent(SCHOOL_A)}/education-reference/catalog`,
      { token: tokenA },
    );
    assert.equal(getCanonical.status, 200, JSON.stringify(getCanonical.data));
    assert.equal(getAlias.status, 200, JSON.stringify(getAlias.data));
    assert.deepEqual(getCanonical.data, getAlias.data);
    assert.equal(getCanonical.data.schoolCode, SCHOOL_A);
    assert.equal(getAlias.deprecation, "true");
    assert.match(String(getAlias.link ?? ""), /education-reference\/catalog/);

    const putAlias = await request(
      `/backoffice/establishments/${encodeURIComponent(SCHOOL_A)}/education-reference/school-activation`,
      { method: "PUT", token: tokenA, body: activationBody },
    );
    assert.equal(putAlias.status, 200, JSON.stringify(putAlias.data));
    assert.equal(putAlias.data.schoolCode, SCHOOL_A);
    assert.equal(putAlias.deprecation, "true");
    assert.match(String(putAlias.link ?? ""), /education-reference\/school-activation/);
    assert.deepEqual(putCanonical.data.schoolCode, putAlias.data.schoolCode);

    const afterCanonical = await request(
      `/education-reference/catalog?schoolCode=${encodeURIComponent(SCHOOL_A)}`,
      { token: tokenA },
    );
    const afterAlias = await request(
      `/backoffice/establishments/${encodeURIComponent(SCHOOL_A)}/education-reference/catalog`,
      { token: tokenA },
    );
    assert.deepEqual(afterCanonical.data, afterAlias.data);

    const getForeign = await request(
      `/education-reference/catalog?schoolCode=${encodeURIComponent(SCHOOL_B)}`,
      { token: tokenA },
    );
    assert.equal(getForeign.status, 403, JSON.stringify(getForeign.data));

    const putForeign = await request(
      `/education-reference/school-activation?schoolCode=${encodeURIComponent(SCHOOL_B)}`,
      { method: "PUT", token: tokenA, body: activationBody },
    );
    assert.equal(putForeign.status, 403, JSON.stringify(putForeign.data));

    const aliasForeign = await request(
      `/backoffice/establishments/${encodeURIComponent(SCHOOL_B)}/education-reference/catalog`,
      { token: tokenA },
    );
    assert.equal(aliasForeign.status, 403, JSON.stringify(aliasForeign.data));

    const getOwnB = await request(
      `/education-reference/catalog?schoolCode=${encodeURIComponent(SCHOOL_B)}`,
      { token: tokenB },
    );
    assert.equal(getOwnB.status, 200, JSON.stringify(getOwnB.data));
    assert.equal(getOwnB.data.schoolCode, SCHOOL_B);
  } finally {
    child.kill("SIGTERM");
  }
});
