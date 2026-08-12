"use strict";

/**
 * Vérification API création enseignant + compte (mémoire) :
 * création + relecture, login, mustChangePassword, authz, isolation,
 * falsification tenant, ambiguïté, homonymes, idempotence, non-régression classes/élèves.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19562;
const BASE = `http://127.0.0.1:${PORT}/api`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { method = "GET", token, body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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

async function login(identifier, schoolCode, password = "1234") {
  const loginResponse = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, schoolCode },
  });
  assert.equal(loginResponse.status, 200, JSON.stringify(loginResponse.data));
  const token = loginResponse.data.accessToken || loginResponse.data.token;
  assert.ok(token, `missing token for ${identifier}@${schoolCode}`);
  return { token, user: loginResponse.data.user };
}

function teacherPayload(overrides = {}) {
  return {
    firstName: "Fatou",
    lastName: "Sow",
    birthDate: "1990-05-01",
    phone: "+243 811 000 001",
    temporaryPassword: "TempPass1",
    speciality: "Histoire",
    ...overrides,
  };
}

async function main() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
      // Force le mode mémoire : éviter l'init PG partiel (doublons classes en base locale).
      DATABASE_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForHealth(child);

    const admin = await login("admin", "CD-2026-0001");
    const adminBi = await login("admin", "BI-2026-0002");
    const teacherSeed = await login("ENS-0001", "CD-2026-0001");
    const parent = await login("+243 820 000 001", "CD-2026-0001");

    const listedBefore = await request("/teachers", { token: admin.token });
    assert.equal(listedBefore.status, 200, JSON.stringify(listedBefore.data));
    assert.ok(Array.isArray(listedBefore.data));
    const seedTeacher = listedBefore.data.find((row) => row.identifier === "ENS-0001");
    assert.ok(seedTeacher, "enseignant seed ENS-0001 attendu");
    assert.ok(
      Array.isArray(seedTeacher.assignments) && seedTeacher.assignments.length > 0,
      "régression : affectations actives absentes de GET /api/teachers",
    );
    assert.ok(
      Array.isArray(seedTeacher.assignedClasses) && seedTeacher.assignedClasses.length > 0,
      "régression : assignedClasses vide",
    );
    assert.ok(Array.isArray(seedTeacher.courses) && seedTeacher.courses.length > 0, "régression : courses vide");

    const seedDetail = await request(`/teachers/${encodeURIComponent(seedTeacher.teacherCode || seedTeacher.publicId)}`, {
      token: admin.token,
    });
    assert.equal(seedDetail.status, 200, JSON.stringify(seedDetail.data));
    assert.ok(
      Array.isArray(seedDetail.data.assignments) && seedDetail.data.assignments.length > 0,
      "régression : affectations absentes du détail",
    );

    const created = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload(),
      headers: { "Idempotency-Key": "teacher-create-1" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.match(String(created.data.teacherCode), /ENS-\d{4}$/);
    assert.equal(created.data.identifier.startsWith("ENS-"), true);
    assert.equal(created.data.mustChangePassword, true);

    const replay = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload(),
      headers: { "Idempotency-Key": "teacher-create-1" },
    });
    assert.equal(replay.status, 201, JSON.stringify(replay.data));
    assert.equal(replay.data.teacherCode, created.data.teacherCode);
    assert.equal(replay.data.idempotentReplay, true);

    const listedAfter = await request("/teachers", { token: admin.token });
    assert.equal(listedAfter.status, 200);
    assert.ok(
      listedAfter.data.some((row) => row.teacherCode === created.data.teacherCode),
      "enseignant absent de la liste après création",
    );

    const fetched = await request(`/teachers/${encodeURIComponent(created.data.teacherCode)}`, {
      token: admin.token,
    });
    assert.equal(fetched.status, 200, JSON.stringify(fetched.data));
    assert.equal(fetched.data.firstName, "Fatou");

    const teacherLogin = await request("/backoffice/login", {
      method: "POST",
      body: {
        identifier: created.data.identifier,
        password: "TempPass1",
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(teacherLogin.status, 200, JSON.stringify(teacherLogin.data));
    assert.equal(teacherLogin.data.user.mustChangePassword, true);
    const teacherToken = teacherLogin.data.accessToken || teacherLogin.data.token;

    const blocked = await request("/teachers", { token: teacherToken });
    assert.equal(blocked.status, 403, JSON.stringify(blocked.data));

    const changed = await request("/auth/change-password", {
      method: "POST",
      token: teacherToken,
      body: { currentPassword: "TempPass1", newPassword: "NewPass12" },
    });
    assert.ok(changed.status >= 200 && changed.status < 300, JSON.stringify(changed.data));

    const relogin = await request("/backoffice/login", {
      method: "POST",
      body: {
        identifier: created.data.identifier,
        password: "NewPass12",
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(relogin.status, 200, JSON.stringify(relogin.data));
    assert.equal(relogin.data.user.mustChangePassword, false);

    // Homonyme accepté
    const homonym = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload({
        birthDate: "1988-01-01",
        phone: "+243 811 000 002",
        temporaryPassword: "TempPass2",
      }),
    });
    assert.equal(homonym.status, 201, JSON.stringify(homonym.data));
    assert.notEqual(homonym.data.teacherCode, created.data.teacherCode);

    // Identité canonique ambiguë refusée
    const ambiguous = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload({
        phone: "+243 811 000 003",
        temporaryPassword: "TempPass3",
      }),
    });
    assert.equal(ambiguous.status, 409, JSON.stringify(ambiguous.data));
    assert.equal(ambiguous.data.code, "TEACHER_CANON_AMBIGUOUS");

    // Dates invalides / âge < 18
    const futureBirth = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload({
        firstName: "Futur",
        lastName: "Naissance",
        birthDate: "2099-01-01",
        phone: "+243 811 000 004",
        temporaryPassword: "TempPass4",
      }),
    });
    assert.equal(futureBirth.status, 400);

    const underage = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload({
        firstName: "Trop",
        lastName: "Jeune",
        birthDate: "2015-01-01",
        entryDate: "2020-01-01",
        phone: "+243 811 000 005",
        temporaryPassword: "TempPass5",
      }),
    });
    assert.equal(underage.status, 400);

    // Falsification tenant / champs techniques
    const forged = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload({
        firstName: "Forge",
        lastName: "Tenant",
        phone: "+243 811 000 006",
        temporaryPassword: "TempPass6",
        schoolCode: "BI-2026-0002",
        role: "Admin School",
        teacherCode: "HACK",
      }),
    });
    assert.equal(forged.status, 400);

    // Isolation : admin BI ne voit pas l'enseignant CD
    const listedBi = await request("/teachers", { token: adminBi.token });
    assert.equal(listedBi.status, 200);
    assert.ok(!listedBi.data.some((row) => row.teacherCode === created.data.teacherCode));

    const crossGet = await request(`/teachers/${encodeURIComponent(created.data.teacherCode)}`, {
      token: adminBi.token,
    });
    assert.equal(crossGet.status, 404);

    // Authz : enseignant / parent refusés en création
    const teacherCreate = await request("/teachers", {
      method: "POST",
      token: teacherSeed.token,
      body: teacherPayload({
        firstName: "Refuse",
        lastName: "Teacher",
        phone: "+243 811 000 007",
        temporaryPassword: "TempPass7",
      }),
    });
    assert.equal(teacherCreate.status, 403);

    const parentCreate = await request("/teachers", {
      method: "POST",
      token: parent.token,
      body: teacherPayload({
        firstName: "Refuse",
        lastName: "Parent",
        phone: "+243 811 000 008",
        temporaryPassword: "TempPass8",
      }),
    });
    assert.equal(parentCreate.status, 403);

    // Non-régression Classes + inscription élèves
    const classCreated = await request("/classes", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Classe teacher-pr ${Date.now()}`,
        academicYearName: "2025-2026",
        status: "active",
      },
    });
    assert.equal(classCreated.status, 201, JSON.stringify(classCreated.data));

    const enrolled = await request(
      `/classes/${encodeURIComponent(classCreated.data.classCode)}/students`,
      {
        method: "POST",
        token: admin.token,
        body: { firstName: "Awa", lastName: "Diop", birthDate: "2012-04-12" },
      },
    );
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));

    console.log("verify-teacher-account-creation.js: OK");
  } catch (error) {
    console.error(stderr);
    throw error;
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
