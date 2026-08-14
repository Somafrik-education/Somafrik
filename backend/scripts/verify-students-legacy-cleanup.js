"use strict";

/**
 * LOT 2 — preuve de clôture Students :
 * - PUT /backoffice/state refuse toute présence de students avant tout merge ;
 * - inscription, liste, détail et modification passent par les APIs PG ;
 * - state.students reste une projection de lecture ;
 * - aucun writer Web/Mobile/BackOffice ne renvoie students au snapshot.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { assertBackOfficeStateReadRemoved, assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19572;
const BASE = `http://127.0.0.1:${PORT}/api`;

const {
  LEGACY_STUDENTS_STATE_WRITE_CODE,
  LEGACY_STUDENTS_STATE_WRITE_MESSAGE,
  stripLegacyStudentsStateWrite,
} = require("../lib/legacyStudentsStateWrite");
const {
  evaluateBackOfficeWriteAccess,
  getWritableBackOfficeEntitiesForPrincipal,
} = require("../lib/backOfficeWritableEntities");

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

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("\nfunction ", start + 10);
  return source.slice(start, next < 0 ? source.length : next);
}

function runUnitGuards() {
  for (const role of ["Admin School", "Secrétaire", "Préfet des études"]) {
    assert.equal(
      getWritableBackOfficeEntitiesForPrincipal({ role }).includes("students"),
      false,
      `${role}: students hors matrice PUT`,
    );
  }
  assert.equal(
    getWritableBackOfficeEntitiesForPrincipal(
      { role: "Super Administrateur Somafrik" },
      ["students", "users", "auditLog"],
    ).includes("students"),
    false,
    "Super Admin: students hors matrice PUT",
  );
  assert.equal(
    evaluateBackOfficeWriteAccess(
      { role: "Admin School", schoolCode: "CD-2026-0001" },
      ["students"],
      ["students", "users"],
    ).ok,
    false,
  );

  const mixed = stripLegacyStudentsStateWrite({
    students: [{ id: "STUDENT-HACK" }],
    users: [{ id: "USER-SENTINEL" }],
  });
  assert.equal(mixed.rejectLegacyStudentsWrite, true);
  assert.equal(Object.prototype.hasOwnProperty.call(mixed.body, "students"), false);

  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert.match(server, /BACKOFFICE_STATE_WRITE_REMOVED_CODE/);
  assert.match(server, /students:\s*runtimeState\.students \?\? \[\]/);

  const postgres = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  const saveState = postgres.match(/async saveBackOfficeState[\s\S]*?^  \}/m);
  assert.ok(saveState, "saveBackOfficeState présent");
  assert.match(postgres, /async getBackOfficeState\(\)[\s\S]*return null/);
  assert.match(saveState[0], /createBackOfficeStateWriteRemovedError/);

  const webContext = fs.readFileSync(path.join(ROOT, "web/src/context/DataContext.tsx"), "utf8");
  assert.match(webContext, /stripClientStudentsFromPutPayload/);

  const mobileApi = fs.readFileSync(path.join(ROOT, "Mobile/src/services/api.ts"), "utf8");
  assert.match(mobileApi, /BACKOFFICE_STATE_READ_REMOVED/);

  const mobileContext = fs.readFileSync(
    path.join(ROOT, "Mobile/src/context/AdminDataContext.tsx"),
    "utf8",
  );
  assert.match(
    mobileContext,
    /entity === "classes" \|\| entity === "schools" \|\| entity === "students"/,
  );

  const legacyBackOffice = fs.readFileSync(path.join(ROOT, "BackOffice/app.js"), "utf8");
  assert.doesNotMatch(legacyBackOffice, /\/backoffice\/state/);
  assert.doesNotMatch(legacyBackOffice, /students:\s*state\.students/);

  console.log("OK unit: Students hors PUT state et clients legacy");
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
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth(child);
    const token = await loginAdmin();
    const stamp = Date.now();

    const createdClass = await request("/classes", {
      method: "POST",
      token,
      body: {
        name: `LOT2-${stamp}`,
        academicYearName: "2025-2026",
        status: "active",
      },
    });
    assert.equal(createdClass.status, 201, JSON.stringify(createdClass.data));
    const classCode = createdClass.data.classCode;
    assert.ok(classCode);

    const enrolled = await request(
      `/classes/${encodeURIComponent(classCode)}/students`,
      {
        method: "POST",
        token,
        body: {
          firstName: "Awa",
          lastName: `LotDeux${stamp}`,
          gender: "Féminin",
          birthDate: "2012-04-12",
        },
      },
    );
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    const studentCode = enrolled.data.studentCode;
    assert.ok(studentCode);

    const detail = await request(`/students/${encodeURIComponent(studentCode)}`, { token });
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
    assert.equal(detail.data.classCode, classCode);

    const patched = await request(`/students/${encodeURIComponent(studentCode)}`, {
      method: "PATCH",
      token,
      body: {
        parentPhone: "+24380002222",
        expectedUpdatedAt: detail.data.updatedAt,
      },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal(patched.data.parentPhone, "+24380002222");

    const studentsBefore = await request("/students", { token });
    assert.equal(studentsBefore.status, 200, JSON.stringify(studentsBefore.data));
    assert.ok(
      (studentsBefore.data ?? []).some(
        (row) => String(row.studentCode ?? row.matricule ?? row.publicId) === studentCode,
      ),
      "GET /students projette l'élève PostgreSQL",
    );

    const usersBefore = await request("/users", { token });
    assert.equal(usersBefore.status, 200);
    const baselineUsers = usersBefore.data ?? [];

    const onlyStudents = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: { students: [{ id: "STUDENT-HACK", schoolCode: "CD-2026-0001" }] },
    });
    assertBackOfficeStateWriteRemoved(onlyStudents);

    const userSentinelId = `USER-LOT2-${stamp}`;
    const mixed = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        students: [{ id: "STUDENT-MIXED-HACK" }],
        users: [
          ...baselineUsers,
          {
            id: userSentinelId,
            name: "Sentinel Lot 2",
            role: "Admin School",
            schoolCode: "CD-2026-0001",
          },
        ],
      },
    });
    assertBackOfficeStateWriteRemoved(mixed);

    const snapshot = await request("/backoffice/state", {
      method: "PUT",
      token,
      body: {
        users: [
          ...baselineUsers,
          { id: userSentinelId, name: "Snapshot Sentinel" },
        ],
      },
    });
    assertBackOfficeStateWriteRemoved(snapshot);

    const usersAfter = await request("/users", { token });
    const studentsAfter = await request("/students", { token });
    assert.equal(usersAfter.status, 200);
    assert.equal(studentsAfter.status, 200);
    assert.equal(
      (usersAfter.data ?? []).some((row) => String(row.id) === userSentinelId),
      false,
      "aucune mutation partielle users",
    );
    assert.equal(
      (studentsAfter.data ?? []).some((row) => String(row.id) === "STUDENT-MIXED-HACK"),
      false,
      "aucune mutation students",
    );
    const projected = (studentsAfter.data ?? []).find(
      (row) => String(row.studentCode ?? row.matricule ?? row.publicId) === studentCode,
    );
    assert.equal(projected?.parentPhone, "+24380002222");

    const importValidation = await request("/backoffice/import/students/validate", {
      method: "POST",
      token,
      body: {
        rows: [
          {
            schoolCode: "CD-2026-0001",
            lastName: `LotDeux${stamp}`,
            firstName: "Awa",
            className: createdClass.data.name,
            matricule: studentCode,
          },
        ],
      },
    });
    assert.equal(importValidation.status, 200, JSON.stringify(importValidation.data));
    assert.equal(importValidation.data.summary.rejected, 1, "import voit le doublon PG projeté");

    console.log(
      "OK http: APIs élèves PG + PUT students seul/mixte/snapshot refusé",
    );
  } finally {
    child.kill("SIGTERM");
    await wait(200);
    if (stderr && process.env.DEBUG_LEGACY_STUDENTS) {
      console.error(stderr);
    }
  }
}

async function main() {
  runUnitGuards();
  await runHttpGuards();
}

if (process.env.SOMAFRIK_VERIFY_STUDENTS_UNIT_ONLY === "true") {
  try {
    runUnitGuards();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
