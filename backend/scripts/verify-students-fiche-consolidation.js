"use strict";

/**
 * PR1 — Consolidation fiche Élève (API mémoire) :
 * liste/détail/patch PostgreSQL, falsification périmètre, isolation, permissions,
 * conflit updatedAt, absence de création hors Classes.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19562;
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

async function login(identifier, schoolCode) {
  const loginResponse = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password: "1234", schoolCode },
  });
  assert.equal(loginResponse.status, 200, JSON.stringify(loginResponse.data));
  const token = loginResponse.data.accessToken || loginResponse.data.token;
  assert.ok(token, `missing token for ${identifier}@${schoolCode}`);
  return token;
}

async function createActiveClass(token, _label, groupCode = "A", levelName = "6ème") {
  const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");
  const ctx = await prepareCanonicalClassContext(request, {
    schoolCode: "CD-2026-0001",
    countryCode: "CD",
    levelName,
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

function assertNoDirectoryCreatePaths() {
  const listPage = fs.readFileSync(
    path.join(ROOT, "web/src/pages/etablissement/StudentsListPage.tsx"),
    "utf8",
  );
  assert.doesNotMatch(listPage, /EntityPage/);
  assert.doesNotMatch(listPage, />\s*Ajouter\s*</);
  assert.doesNotMatch(listPage, /depuis un contact/i);
  assert.doesNotMatch(listPage, /primaryActions=\{[^}]*Button/);
  assert.match(listPage, /studentsApi/);
  assert.match(listPage, /Inscrire/);
  assert.match(listPage, /primaryActions=\{null\}/);

  const entityPage = fs.readFileSync(path.join(ROOT, "web/src/pages/EntityPage.tsx"), "utf8");
  assert.doesNotMatch(
    entityPage,
    /module\?\.key === "students" \? "student"/,
  );

  const workspaceHook = fs.readFileSync(
    path.join(ROOT, "web/src/hooks/useStudentWorkspace.ts"),
    "utf8",
  );
  assert.match(workspaceHook, /studentsApi\.get/);
  assert.doesNotMatch(workspaceHook, /state\.students\.find/);
}

async function main() {
  assertNoDirectoryCreatePaths();

  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      SOMAFRIK_DB_REQUIRED: "false",
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

    const tokenCd = await login("admin", "CD-2026-0001");
    const tokenBi = await login("admin", "BI-2026-0002");

    // Création impossible sans classe (pas de POST /api/students).
    const bareCreate = await request("/students", {
      method: "POST",
      token: tokenCd,
      body: { firstName: "Hack", lastName: "Create" },
    });
    assert.ok(
      bareCreate.status === 404 || bareCreate.status === 405 || bareCreate.status === 403,
      `unexpected POST /students status ${bareCreate.status}`,
    );

    // Deux classes distinctes pour tester les états sans dépendre d'une ancienne
    // unicité de nom. Le contrat métier reste l'unicité structurelle de l'offre.
    const activeClass = await createActiveClass(tokenCd, "Fiche active", "F1", "6ème");
    const inactiveClass = await createActiveClass(tokenCd, "Fiche inactive", "F2", "5ème");
    const patched = await request(`/classes/${encodeURIComponent(inactiveClass.classCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: { status: "inactive" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));

    const inactiveEnroll = await request(
      `/classes/${encodeURIComponent(inactiveClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Ibra", lastName: "Fall" },
      },
    );
    assert.equal(inactiveEnroll.status, 409, JSON.stringify(inactiveEnroll.data));

    const enrolled = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: {
          firstName: "Awa",
          lastName: "Diop",
          gender: "Féminin",
          birthDate: "2012-04-12",
          schoolCode: "HACK",
        },
      },
    );
    assert.equal(enrolled.status, 400, JSON.stringify(enrolled.data));

    const enrolledOk = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: {
          firstName: "Awa",
          lastName: "Diop",
          gender: "Féminin",
          birthDate: "2012-04-12",
        },
      },
    );
    assert.equal(enrolledOk.status, 201, JSON.stringify(enrolledOk.data));
    const studentCode = enrolledOk.data.student?.studentCode ?? enrolledOk.data.studentCode;
    assert.ok(studentCode);

    const list = await request("/students", { token: tokenCd });
    assert.equal(list.status, 200, JSON.stringify(list.data));
    const listRows = Array.isArray(list.data) ? list.data : list.data?.items ?? list.data?.data ?? [];
    assert.ok(listRows.some((row) => row.studentCode === studentCode));

    const detail = await request(`/students/${encodeURIComponent(studentCode)}`, { token: tokenCd });
    assert.equal(detail.status, 200, JSON.stringify(detail.data));
    assert.equal(detail.data.studentCode, studentCode);
    assert.ok(Array.isArray(detail.data.enrollments));
    assert.ok(Array.isArray(detail.data.guardians));
    assert.ok(detail.data.medical);
    assert.ok(Array.isArray(detail.data.documents));
    assert.ok(detail.data.access?.notesPath);
    assert.equal(detail.data.classCode, activeClass.classCode);

    const forgedPatch = await request(`/students/${encodeURIComponent(studentCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: {
        parentPhone: "+243111",
        classCode: "FORGED",
        expectedUpdatedAt: detail.data.updatedAt,
      },
    });
    assert.equal(forgedPatch.status, 400, JSON.stringify(forgedPatch.data));

    const forgedYear = await request(`/students/${encodeURIComponent(studentCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: {
        parentPhone: "+243111",
        academicYearName: "2099-2100",
        expectedUpdatedAt: detail.data.updatedAt,
      },
    });
    assert.equal(forgedYear.status, 400, JSON.stringify(forgedYear.data));

    const forgedSchool = await request(`/students/${encodeURIComponent(studentCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: {
        parentPhone: "+243111",
        schoolCode: "BI-2026-0002",
        expectedUpdatedAt: detail.data.updatedAt,
      },
    });
    assert.equal(forgedSchool.status, 400, JSON.stringify(forgedSchool.data));

    const updated = await request(`/students/${encodeURIComponent(studentCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: {
        parentPhone: "+24380001111",
        expectedUpdatedAt: detail.data.updatedAt,
      },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.parentPhone, "+24380001111");
    assert.equal(updated.data.classCode, activeClass.classCode);

    const conflict = await request(`/students/${encodeURIComponent(studentCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: {
        parentPhone: "+24380002222",
        expectedUpdatedAt: detail.data.updatedAt,
      },
    });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.data));

    const reread = await request(`/students/${encodeURIComponent(studentCode)}`, { token: tokenCd });
    assert.equal(reread.status, 200);
    assert.equal(reread.data.parentPhone, "+24380001111");

    const cross = await request(`/students/${encodeURIComponent(studentCode)}`, { token: tokenBi });
    assert.equal(cross.status, 404, JSON.stringify(cross.data));

    const listOther = await request("/students", { token: tokenBi });
    assert.equal(listOther.status, 200);
    const otherRows = Array.isArray(listOther.data)
      ? listOther.data
      : listOther.data?.items ?? listOther.data?.data ?? [];
    assert.equal(
      otherRows.some((row) => row.studentCode === studentCode),
      false,
    );

    console.log("verify-students-fiche-consolidation.js: OK");
  } catch (error) {
    console.error(error);
    console.error(stderr);
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
  }
}

main();
