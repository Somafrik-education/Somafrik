"use strict";

/**
 * LOT Parents & élèves — contrat HTTP mémoire.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { collectSensitiveUserFieldPaths } = require("../lib/sanitizeUserForResponse");
const { assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

const ROOT = require("node:path").resolve(__dirname, "../..");
const PORT = 19691;
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

function listRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function main() {
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
    const schoolToken = await login("admin", "1234", "CD-2026-0001");
    const superToken = await login("superadmin", "1234");

    const legacy = await request("/backoffice/state", {
      method: "PUT",
      token: superToken,
      body: { relations: [] },
    });
    assertBackOfficeStateWriteRemoved(legacy);

    const studentsRes = await request("/students", { token: schoolToken });
    assert.equal(studentsRes.status, 200, JSON.stringify(studentsRes.data));
    let students = listRows(studentsRes.data);
    if (students.length < 2) {
      students = [
        { id: "CD-IN-EL-26-001", studentCode: "CD-IN-EL-26-001" },
        { id: "CD-IN-EL-26-002", studentCode: "CD-IN-EL-26-002" },
      ];
    }
    const studentA = String(students[0].id || students[0].studentCode);
    const studentB = String(students[1].id || students[1].studentCode);

    const stamp = Date.now();
    const created = await request("/parents/link", {
      method: "POST",
      token: schoolToken,
      body: {
        studentId: studentA,
        firstName: "Baudouin",
        lastName: "OKITO",
        phone: `+24381${String(stamp).slice(-7)}`,
        email: `baudouin.${stamp}@test.local`,
        relationType: "parent_student",
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.created, true);
    assert.equal(collectSensitiveUserFieldPaths(created.data.user).length, 0);
    const parentUserId = created.data.user.id;
    const parentPhone = `+24381${String(stamp).slice(-7)}`;
    const parentEmail = `baudouin.${stamp}@test.local`;

    const second = await request("/parents/link", {
      method: "POST",
      token: schoolToken,
      body: {
        studentId: studentB,
        phone: parentPhone,
        email: parentEmail,
        relationType: "parent_student",
      },
    });
    assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.equal(second.data.user.id, parentUserId);

    const duplicate = await request("/parents/link", {
      method: "POST",
      token: schoolToken,
      body: {
        studentId: studentA,
        phone: parentPhone,
        email: parentEmail,
        relationType: "parent_student",
      },
    });
    assert.equal(duplicate.status, 200, JSON.stringify(duplicate.data));
    assert.equal(duplicate.data.created, false);

    const identity = await request(
      `/parents/identity?phone=${encodeURIComponent(parentPhone)}&email=${encodeURIComponent(parentEmail)}`,
      { token: schoolToken },
    );
    assert.equal(identity.status, 200, JSON.stringify(identity.data));
    assert.equal(identity.data.found, true);
    assert.equal(identity.data.user.id, parentUserId);

    const missing = await request("/parents/link", {
      method: "POST",
      token: schoolToken,
      body: { firstName: "X", lastName: "Y", phone: "+243800000000" },
    });
    assert.equal(missing.status, 400);

    const unknownStudent = await request("/parents/link", {
      method: "POST",
      token: schoolToken,
      body: {
        studentId: "00000000-0000-0000-0000-000000000099",
        firstName: "X",
        lastName: "Y",
        phone: "+243800000001",
      },
    });
    assert.equal(unknownStudent.status, 404);

    let teacherToken = null;
    try {
      teacherToken = await login("enseignant", "1234", "CD-2026-0001");
    } catch {
      teacherToken = null;
    }
    if (teacherToken) {
      const forbidden = await request("/parents/link", {
        method: "POST",
        token: teacherToken,
        body: {
          studentId: studentA,
          firstName: "No",
          lastName: "Right",
          phone: "+243800000002",
        },
      });
      assert.equal(forbidden.status, 403, JSON.stringify(forbidden.data));
    }

    const archived = await request(`/parents/relations/${encodeURIComponent(created.data.relation.id)}`, {
      method: "PATCH",
      token: schoolToken,
      body: { status: "archived" },
    });
    assert.equal(archived.status, 200, JSON.stringify(archived.data));

    const secondParent = await request("/parents/link", {
      method: "POST",
      token: schoolToken,
      body: {
        studentId: studentA,
        firstName: "Marie",
        lastName: "OKITO",
        phone: `+24382${String(stamp).slice(-7)}`,
        email: `marie.${stamp}@test.local`,
        relationType: "parent_student",
      },
    });
    assert.equal(secondParent.status, 201, JSON.stringify(secondParent.data));
    assert.notEqual(secondParent.data.user.id, parentUserId);

    const ambiguous = await request("/parents/link", {
      method: "POST",
      token: schoolToken,
      body: {
        studentId: studentB,
        firstName: "Ambigu",
        lastName: "Parent",
        email: parentEmail,
        phone: `+24382${String(stamp).slice(-7)}`,
        relationType: "parent_student",
      },
    });
    assert.equal(ambiguous.status, 409, JSON.stringify(ambiguous.data));
    assert.equal(ambiguous.data.code, "PARENT_IDENTITY_AMBIGUOUS");

    const parentPin = created.data.temporaryPassword;
    if (parentPin) {
      const parentLogin = await request("/login", {
        method: "POST",
        body: {
          role: "parent_student",
          schoolCode: "CD-2026-0001",
          identifier: parentEmail,
          pin: parentPin,
        },
      });
      assert.equal(parentLogin.status, 200, JSON.stringify(parentLogin.data));
      assert.equal(parentLogin.data.role, "parent_student");
      assert.equal(parentLogin.data.user.role, "Parent");
    }

    const usersRes = await request("/backoffice/users", { token: schoolToken });
    const users = listRows(usersRes.data);
    const teacher = users.find((row) => String(row.role ?? "") === "Enseignant" && (row.phone || row.email));
    if (teacher) {
      const teacherLink = await request("/parents/link", {
        method: "POST",
        token: schoolToken,
        body: {
          studentId: studentA,
          firstName: teacher.firstName || "Jean",
          lastName: teacher.lastName || "Kabeya",
          phone: teacher.phone,
          email: teacher.email,
          relationType: "parent_student",
        },
      });
      assert.equal(teacherLink.status === 201 || teacherLink.status === 200, true, JSON.stringify(teacherLink.data));
      assert.equal(String(teacherLink.data.user.id), String(teacher.id));
      const teacherKeys = teacherLink.data.user.roleKeys || [];
      assert.ok(teacherKeys.includes("TEACHER") || teacherKeys.includes("PARENT"));
      const teacherPin = teacher.temporaryPassword || teacher.password || "1234";
      const dualRoleLogin = await request("/login", {
        method: "POST",
        body: {
          role: "parent_student",
          schoolCode: "CD-2026-0001",
          identifier: teacher.email || teacher.phone || teacher.identifier,
          pin: teacherPin,
        },
      });
      assert.equal(dualRoleLogin.status, 200, JSON.stringify(dualRoleLogin.data));
      assert.equal(dualRoleLogin.data.user.role, "Parent");
    }

    const relations = await request("/backoffice/relations", { token: schoolToken });
    assert.equal(relations.status, 200);
    assert.ok(Array.isArray(listRows(relations.data)));

    console.log("verify-parent-linking.js OK");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
