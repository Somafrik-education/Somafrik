"use strict";

/**
 * Vérification API inscription élève depuis une classe (mémoire) :
 * création + relecture, falsification corps, rôles, isolation, classe inactive.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19552;
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

async function createActiveClass(token, label) {
  const created = await request("/classes", {
    method: "POST",
    token,
    body: {
      name: `${label} ${Date.now()}`,
      academicYearName: "2025-2026",
      status: "active",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  return created.data;
}

async function main() {
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

    const tokenCd = await login("admin", "CD-2026-0001");
    const tokenBi = await login("admin", "BI-2026-0002");
    const tokenTeacher = await login("ENS-0001", "CD-2026-0001");

    const activeClass = await createActiveClass(tokenCd, "Classe active");
    const inactiveClass = await createActiveClass(tokenCd, "Classe à désactiver");
    const patched = await request(`/classes/${encodeURIComponent(inactiveClass.classCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: { status: "inactive" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));

    const classOtherSchool = await createActiveClass(tokenBi, "Classe autre école");

    const enrolled = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Awa", lastName: "Diop", gender: "Féminin", birthDate: "2012-04-12" },
      },
    );
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    assert.match(enrolled.data.studentCode, /^ELE-CD-0001-0001-/);

    const listed = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      { token: tokenCd },
    );
    assert.equal(listed.status, 200);
    assert.ok(listed.data.some((row) => row.studentCode === enrolled.data.studentCode));

    const fetched = await request(`/students/${encodeURIComponent(enrolled.data.studentCode)}`, {
      token: tokenCd,
    });
    assert.equal(fetched.status, 200, JSON.stringify(fetched.data));
    assert.equal(fetched.data.classCode, activeClass.classCode);

    const enrolledOther = await request(
      `/classes/${encodeURIComponent(classOtherSchool.classCode)}/students`,
      {
        method: "POST",
        token: tokenBi,
        body: { firstName: "Ibra", lastName: "Fall" },
      },
    );
    assert.equal(enrolledOther.status, 201, JSON.stringify(enrolledOther.data));
    assert.match(enrolledOther.data.studentCode, /^ELE-BI-0002-0001-/);
    assert.notEqual(enrolled.data.studentCode, enrolledOther.data.studentCode);

    // Enseignant hors classe affectée : pas de lecture du roster.
    const teacherListDenied = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      { token: tokenTeacher },
    );
    assert.equal(teacherListDenied.status, 403, JSON.stringify(teacherListDenied.data));

    const teacherStudentDenied = await request(
      `/students/${encodeURIComponent(enrolled.data.studentCode)}`,
      { token: tokenTeacher },
    );
    assert.equal(teacherStudentDenied.status, 404, JSON.stringify(teacherStudentDenied.data));

    // Enseignant sans aucune affectation (classNames: []) : 404 même en connaissant le matricule.
    const { TokenService } = require("../services/tokenService");
    const tokenService = new TokenService();
    const tokenTeacherNoAssignment = tokenService.createAccessToken({
      sub: "USER-T-NO-ASSIGN",
      identifier: "ENS-NO-ASSIGN",
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      permissions: ["Élèves:READ", "Voir élèves"],
      classNames: [],
      classCodes: [],
      classIds: [],
      assignments: [],
      mustChangePassword: false,
    });
    const teacherEmptyAssignmentsDenied = await request(
      `/students/${encodeURIComponent(enrolled.data.studentCode)}`,
      { token: tokenTeacherNoAssignment },
    );
    assert.equal(
      teacherEmptyAssignmentsDenied.status,
      404,
      JSON.stringify(teacherEmptyAssignmentsDenied.data),
    );

    // Affectation inactive avec le bon classCode → 404 (fail-closed sur le statut).
    const tokenTeacherInactiveAssignment = tokenService.createAccessToken({
      sub: "USER-T-INACTIVE",
      identifier: "ENS-INACTIVE",
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      permissions: ["Élèves:READ", "Voir élèves"],
      classNames: [activeClass.name],
      classCodes: [activeClass.classCode],
      classIds: [],
      assignments: [
        {
          className: activeClass.name,
          classCode: activeClass.classCode,
          status: "inactive",
        },
      ],
      mustChangePassword: false,
    });
    const teacherInactiveDenied = await request(
      `/students/${encodeURIComponent(enrolled.data.studentCode)}`,
      { token: tokenTeacherInactiveAssignment },
    );
    assert.equal(teacherInactiveDenied.status, 404, JSON.stringify(teacherInactiveDenied.data));
    const teacherInactiveRosterDenied = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      { token: tokenTeacherInactiveAssignment },
    );
    assert.equal(
      teacherInactiveRosterDenied.status,
      403,
      JSON.stringify(teacherInactiveRosterDenied.data),
    );

    // Homonymes inter-années : principal avec seulement classNames → refus HTTP.
    const priorYearName = "6ème A Homonyme";
    const priorYear = await request("/classes", {
      method: "POST",
      token: tokenCd,
      body: {
        name: priorYearName,
        academicYearName: "2024-2025",
        status: "active",
      },
    });
    assert.equal(priorYear.status, 201, JSON.stringify(priorYear.data));
    const currentHomonym = await request("/classes", {
      method: "POST",
      token: tokenCd,
      body: {
        name: priorYearName,
        academicYearName: "2025-2026",
        status: "active",
      },
    });
    assert.equal(currentHomonym.status, 201, JSON.stringify(currentHomonym.data));
    assert.notEqual(priorYear.data.classCode, currentHomonym.data.classCode);

    const enrolledHomonym = await request(
      `/classes/${encodeURIComponent(currentHomonym.data.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Homo", lastName: "Nyme" },
      },
    );
    assert.equal(enrolledHomonym.status, 201, JSON.stringify(enrolledHomonym.data));

    const tokenTeacherNameOnly = tokenService.createAccessToken({
      sub: "USER-T-NAME-ONLY",
      identifier: "ENS-NAME-ONLY",
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      permissions: ["Élèves:READ", "Voir élèves"],
      classNames: [priorYearName],
      classCodes: [],
      classIds: [],
      assignments: [{ className: priorYearName, status: "active" }],
      mustChangePassword: false,
    });
    const teacherNameOnlyStudentDenied = await request(
      `/students/${encodeURIComponent(enrolledHomonym.data.studentCode)}`,
      { token: tokenTeacherNameOnly },
    );
    assert.equal(
      teacherNameOnlyStudentDenied.status,
      404,
      JSON.stringify(teacherNameOnlyStudentDenied.data),
    );
    const teacherNameOnlyRosterDenied = await request(
      `/classes/${encodeURIComponent(currentHomonym.data.classCode)}/students`,
      { token: tokenTeacherNameOnly },
    );
    assert.equal(
      teacherNameOnlyRosterDenied.status,
      403,
      JSON.stringify(teacherNameOnlyRosterDenied.data),
    );

    // Contrôle positif : affectation active + classCode stable → lecture autorisée.
    const tokenTeacherActiveCode = tokenService.createAccessToken({
      sub: "USER-T-ACTIVE-CODE",
      identifier: "ENS-ACTIVE-CODE",
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      permissions: ["Élèves:READ", "Voir élèves"],
      classNames: [currentHomonym.data.name],
      classCodes: [currentHomonym.data.classCode],
      assignments: [
        {
          className: currentHomonym.data.name,
          classCode: currentHomonym.data.classCode,
          status: "active",
        },
      ],
      mustChangePassword: false,
    });
    const teacherActiveAllowed = await request(
      `/students/${encodeURIComponent(enrolledHomonym.data.studentCode)}`,
      { token: tokenTeacherActiveCode },
    );
    assert.equal(teacherActiveAllowed.status, 200, JSON.stringify(teacherActiveAllowed.data));
    const teacherActiveRoster = await request(
      `/classes/${encodeURIComponent(currentHomonym.data.classCode)}/students`,
      { token: tokenTeacherActiveCode },
    );
    assert.equal(teacherActiveRoster.status, 200, JSON.stringify(teacherActiveRoster.data));

    // Parent : pas de dossier d'un autre élève du même établissement.
    const tokenParent = await login("+243 820 000 001", "CD-2026-0001");
    const parentOtherStudentDenied = await request(
      `/students/${encodeURIComponent(enrolled.data.studentCode)}`,
      { token: tokenParent },
    );
    assert.equal(parentOtherStudentDenied.status, 404, JSON.stringify(parentOtherStudentDenied.data));

    const parentClassDenied = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      { token: tokenParent },
    );
    assert.equal(parentClassDenied.status, 403, JSON.stringify(parentClassDenied.data));

    const tamperClassCode = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: {
          firstName: "Hack",
          lastName: "Class",
          classCode: activeClass.classCode,
        },
      },
    );
    assert.equal(tamperClassCode.status, 400, JSON.stringify(tamperClassCode.data));

    const tamperSchoolCode = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: {
          firstName: "Hack",
          lastName: "School",
          schoolCode: "CD-2026-0001",
        },
      },
    );
    assert.equal(tamperSchoolCode.status, 400, JSON.stringify(tamperSchoolCode.data));

    const emptyScopeKey = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Hack", lastName: "Empty", className: "" },
      },
    );
    assert.equal(emptyScopeKey.status, 400, JSON.stringify(emptyScopeKey.data));

    const snakeScopeKey = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Hack", lastName: "Snake", class_code: activeClass.classCode },
      },
    );
    assert.equal(snakeScopeKey.status, 400, JSON.stringify(snakeScopeKey.data));

    const snakeSchoolId = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Hack", lastName: "SnakeSchool", school_id: "x" },
      },
    );
    assert.equal(snakeSchoolId.status, 400, JSON.stringify(snakeSchoolId.data));

    const impossibleBirthDate = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Bad", lastName: "Date", birthDate: "2026-02-30" },
      },
    );
    assert.equal(impossibleBirthDate.status, 400, JSON.stringify(impossibleBirthDate.data));

    const teacherDenied = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenTeacher,
        body: { firstName: "Refus", lastName: "Teacher" },
      },
    );
    assert.equal(teacherDenied.status, 403, JSON.stringify(teacherDenied.data));

    const crossTenant = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      { token: tokenBi },
    );
    assert.equal(crossTenant.status, 404, JSON.stringify(crossTenant.data));

    const crossEnroll = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenBi,
        body: { firstName: "Leak", lastName: "Tenant" },
      },
    );
    assert.equal(crossEnroll.status, 404, JSON.stringify(crossEnroll.data));

    const inactiveDenied = await request(
      `/classes/${encodeURIComponent(inactiveClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Refus", lastName: "Inactive" },
      },
    );
    assert.equal(inactiveDenied.status, 409, JSON.stringify(inactiveDenied.data));

    const concurrent = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        request(`/classes/${encodeURIComponent(activeClass.classCode)}/students`, {
          method: "POST",
          token: tokenCd,
          body: { firstName: `C${index}`, lastName: "Parallel" },
        }),
      ),
    );
    for (const result of concurrent) {
      assert.equal(result.status, 201, JSON.stringify(result.data));
    }
    const concurrentCodes = new Set(concurrent.map((item) => item.data.studentCode));
    assert.equal(concurrentCodes.size, 3);

    console.log("verify-class-student-enrollment: SUCCESS");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
    if (stderr && process.env.DEBUG_CLASS_STUDENTS_VERIFY) {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
