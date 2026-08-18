"use strict";

/**
 * Contrat HTTP + gardes source — roster Présences canonique (classId / classCode).
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19693;
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

async function login(identifier, password, schoolCode) {
  const result = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, ...(schoolCode ? { schoolCode } : {}) },
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  let token = result.data.accessToken || result.data.token;
  if ((result.data?.user?.mustChangePassword || result.data?.mustChangePassword) && String(password).length >= 8) {
    const changed = await request("/auth/change-password", {
      method: "POST",
      token,
      body: { newPassword: password },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    token = changed.data.accessToken || changed.data.token || token;
  }
  return token;
}

function assertSourceGuards() {
  const presencesPage = fs.readFileSync(path.join(ROOT, "web/src/pages/PresencesPage.tsx"), "utf8");
  assert.doesNotMatch(presencesPage, /assignStudentToClass/);
  assert.doesNotMatch(presencesPage, /update\(\{\s*students/);
  assert.doesNotMatch(presencesPage, /dedupeClassesByName/);
  assert.doesNotMatch(presencesPage, /student\.className\s*===\s*selectedClassName/);
  assert.doesNotMatch(presencesPage, /UNASSIGNED_CLASS/);
  assert.match(presencesPage, /classStudentsApi/);
  assert.match(presencesPage, /selectedClassId/);
  assert.match(presencesPage, /classId: selectedCard\.classId/);

  const roster = fs.readFileSync(path.join(ROOT, "web/src/lib/presenceRoster.ts"), "utf8");
  assert.match(roster, /classId/);
  assert.match(roster, /NEVER by className|jamais className/i);
  assert.match(roster, /currentUser\?\.assignments|currentUser\.assignments/);
  assert.match(roster, /assignedClassIds/);
  assert.match(roster, /isExplicitlyActiveAssignmentStatus/);
  assert.doesNotMatch(roster, /if \(!normalized\) return true/);

  const upsert = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  assert.match(upsert, /resolveAttendanceTargetClass/);
  assert.match(upsert, /teacherHasActiveAssignmentForClassId/);
  assert.match(upsert, /activeEnrollmentMatchesRequestedClass/);
}

async function createClass(token, groupCode) {
  const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");
  const ctx = await prepareCanonicalClassContext(request, {
    schoolCode: "CD-2026-0001",
    countryCode: "CD",
    levelName: "6ème",
    groupCode,
  });
  const created = await postCanonicalClass(request, token, {
    academicYearId: ctx.academicYear.id,
    levelId: ctx.level.id,
    groupId: ctx.group.id,
    status: "active",
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data;
}

async function main() {
  assertSourceGuards();

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
    const adminToken = await login("admin", "1234", "CD-2026-0001");
    const teacherToken = await login("ENS-0001", "1234", "CD-2026-0001");
    const otherSchoolToken = await login("admin", "1234", "BI-2026-0002");

    const legacy = await request("/backoffice/state", {
      method: "PUT",
      token: adminToken,
      body: { students: [{ id: "HACK", className: "2ème A" }] },
    });
    assertBackOfficeStateWriteRemoved(legacy);

    const classA = await createClass(adminToken, "P0A");
    const classB = await createClass(adminToken, "P0B");
    assert.ok(classA.classId || classA.id);
    assert.ok(classA.classCode);
    assert.notEqual(classA.id, classA.classCode, "id DTO = UUID, pas classCode");
    assert.equal(classA.classId, classA.id);
    assert.equal(classA.name, classB.name, "C — homonymes");
    assert.notEqual(classA.classId, classB.classId);
    assert.notEqual(classA.classCode, classB.classCode);

    const enrolled = await request(`/classes/${encodeURIComponent(classA.classCode)}/students`, {
      method: "POST",
      token: adminToken,
      body: { firstName: "Awa", lastName: "Diop" },
    });
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    assert.equal(enrolled.data.student.classId, classA.classId);
    assert.equal(enrolled.data.student.classCode, classA.classCode);

    const rosterA = await request(`/classes/${encodeURIComponent(classA.classCode)}/students`, {
      token: adminToken,
    });
    assert.equal(rosterA.status, 200, JSON.stringify(rosterA.data));
    assert.equal(rosterA.data.length, 1);
    assert.equal(rosterA.data[0].classId, classA.classId);

    const rosterB = await request(`/classes/${encodeURIComponent(classB.classCode)}/students`, {
      token: adminToken,
    });
    assert.equal(rosterB.status, 200, JSON.stringify(rosterB.data));
    assert.equal(rosterB.data.length, 0, "C — classe B homonyme vide");

    const listed = await request("/classes", { token: adminToken });
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    const cardA = listed.data.find((row) => row.classCode === classA.classCode);
    assert.equal(cardA.students, 1, "compteur carte = enrollment_count PG/mémoire");
    const cardB = listed.data.find((row) => row.classCode === classB.classCode);
    assert.equal(cardB.students, 0);

    const teacherRoster = await request(`/classes/${encodeURIComponent(classA.classCode)}/students`, {
      token: teacherToken,
    });
    assert.equal(teacherRoster.status, 403, JSON.stringify(teacherRoster.data));

    const teacherClasses = await request("/classes", { token: teacherToken });
    assert.ok([200, 403].includes(teacherClasses.status), JSON.stringify(teacherClasses.data));
    if (teacherClasses.status === 200) {
      assert.equal(
        teacherClasses.data.some((row) => row.classCode === classA.classCode),
        false,
        "E — classe absente de la portée enseignant non affecté",
      );
    }

    const foreign = await request(`/classes/${encodeURIComponent(classA.classCode)}/students`, {
      token: otherSchoolToken,
    });
    assert.ok([403, 404].includes(foreign.status), `H — tenant étranger ${foreign.status}`);

    console.log("verify-presences-roster.js: OK");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
