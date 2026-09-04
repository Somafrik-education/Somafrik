"use strict";

/**
 * P0-2 HTTP — Superadmin / Admin Pays → 403 sur les données personnelles
 * établissement, avec et sans schoolCode. Rôles établissement : pas 403.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const ROOT = require("node:path").resolve(__dirname, "../..");
const PORT = 19746;
const BASE = `http://127.0.0.1:${PORT}/api`;
const SCHOOL = "CD-2026-0001";
const SCHOOL_V2 = "CD-IN-26-001";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { method = "GET", token, headers = {} } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
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
  const response = await fetch(`${BASE}/backoffice/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password, ...(schoolCode ? { schoolCode } : {}) }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data.accessToken || data.token;
}

const FORBIDDEN_PATHS = [
  "/students",
  `/students?schoolCode=${encodeURIComponent(SCHOOL)}`,
  "/teachers",
  `/teachers?schoolCode=${encodeURIComponent(SCHOOL)}`,
  "/notes",
  "/evaluations",
  "/presences",
  "/payments",
  "/backoffice/messages",
  "/v2/documents",
  "/data-export",
  `/data-export?schoolCode=${encodeURIComponent(SCHOOL)}`,
  "/audit",
];

const PLATFORM_PATHS = ["/backoffice/countries", "/backoffice/establishments"];

async function assertForbidden(token, label) {
  for (const pathname of FORBIDDEN_PATHS) {
    const result = await request(pathname, { token });
    assert.equal(
      result.status,
      403,
      `${label} ${pathname} attendu 403, reçu ${result.status} ${JSON.stringify(result.data)}`,
    );
  }
  for (const schoolCode of [SCHOOL, SCHOOL_V2]) {
    const headerProbe = await request("/students", {
      token,
      headers: { "X-Somafrik-School-Code": schoolCode },
    });
    assert.equal(
      headerProbe.status,
      403,
      `${label} header schoolCode=${schoolCode} GET /students attendu 403, reçu ${headerProbe.status} ${JSON.stringify(headerProbe.data)}`,
    );
    const exportProbe = await request("/data-export", {
      token,
      headers: { "X-Somafrik-School-Code": schoolCode },
    });
    assert.equal(
      exportProbe.status,
      403,
      `${label} header schoolCode=${schoolCode} GET /data-export attendu 403, reçu ${exportProbe.status} ${JSON.stringify(exportProbe.data)}`,
    );
  }
}

async function main() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      DATABASE_URL: "",
      SOMAFRIK_DB_REQUIRED: "false",
      SOMAFRIK_DISABLE_LOGIN_LOCKOUT: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  try {
    await waitForHealth(child);
    const superToken = await login("superadmin", "1234");
    const countryToken = await login("admin-rdc", "1234");
    const schoolToken = await login("admin", "1234", SCHOOL);

    await assertForbidden(superToken, "SUPER_ADMIN");
    await assertForbidden(countryToken, "COUNTRY_ADMIN");

    for (const pathname of PLATFORM_PATHS) {
      const superOk = await request(pathname, { token: superToken });
      assert.notEqual(superOk.status, 403, `SUPER_ADMIN ${pathname} ne doit pas être 403`);
      assert.ok(superOk.status < 500, `SUPER_ADMIN ${pathname} ${superOk.status}`);
    }

    const schoolStudents = await request("/students", { token: schoolToken });
    assert.notEqual(
      schoolStudents.status,
      403,
      `Admin School GET /students ne doit pas être 403 (${schoolStudents.status} ${JSON.stringify(schoolStudents.data)})`,
    );

    const schoolExport = await request("/data-export", { token: schoolToken });
    assert.notEqual(schoolExport.status, 403, `Admin School GET /data-export ${schoolExport.status}`);

    const teacherLogin = await fetch(`${BASE}/backoffice/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: "ENS-0001", password: "1234", schoolCode: SCHOOL }),
    });
    if (teacherLogin.status === 200) {
      const teacherData = await teacherLogin.json();
      const teacherToken = teacherData.accessToken || teacherData.token;
      const teacherStudents = await request("/students", { token: teacherToken });
      assert.notEqual(
        teacherStudents.data?.code,
        "PLATFORM_PERSONAL_DATA_DENIED",
        `Enseignant GET /students ne doit pas recevoir le deny plateforme (${teacherStudents.status} ${JSON.stringify(teacherStudents.data)})`,
      );
    }

    console.log("verify-platform-personal-data-deny: SUCCESS");
  } catch (error) {
    console.error(stderr.slice(-4000));
    throw error;
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
