"use strict";

/**
 * Vérification API inscription élève depuis une classe (mémoire) :
 * création + relecture, falsification corps, rôles, isolation, classe inactive.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { studentIdentityInitials } = require("../lib/studentCanonicalIdentifier");

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
  const session = await loginSession(identifier, schoolCode);
  return session.token;
}

async function loginWithoutPasswordGate(identifier, schoolCode) {
  const session = await loginSession(identifier, schoolCode);
  if (!session.user?.mustChangePassword) return session.token;
  const nextPassword = "PrefetPass12";
  const changed = await request("/auth/change-password", {
    method: "POST",
    token: session.token,
    body: { currentPassword: "1234", newPassword: nextPassword },
  });
  assert.ok(changed.status >= 200 && changed.status < 300, JSON.stringify(changed.data));
  const next = await loginSessionWithPassword(identifier, schoolCode, nextPassword);
  return next.token;
}

async function loginSessionWithPassword(identifier, schoolCode, password) {
  const loginResponse = await request("/backoffice/login", {
    method: "POST",
    body: { identifier, password, schoolCode },
  });
  assert.equal(loginResponse.status, 200, JSON.stringify(loginResponse.data));
  const token = loginResponse.data.accessToken || loginResponse.data.token;
  const refreshToken = loginResponse.data.refreshToken;
  assert.ok(token, `missing token for ${identifier}@${schoolCode}`);
  assert.ok(refreshToken, `missing refreshToken for ${identifier}@${schoolCode}`);
  return { token, refreshToken, user: loginResponse.data.user };
}

async function loginSession(identifier, schoolCode) {
  return loginSessionWithPassword(identifier, schoolCode, "1234");
}

async function refreshAccessToken(refreshToken) {
  const refreshed = await request("/auth/refresh", {
    method: "POST",
    body: { refreshToken },
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.data));
  assert.ok(refreshed.data.accessToken, "missing accessToken after refresh");
  return refreshed.data.accessToken;
}

function assertNoSecretLeak(payload, label) {
  const serialized = JSON.stringify(payload ?? null);
  assert.equal(payload?.temporarySecret, undefined, `${label}: temporarySecret`);
  assert.equal(payload?.credentials, undefined, `${label}: credentials`);
  assert.doesNotMatch(serialized, /temporarySecret/i, `${label}: clé temporarySecret`);
  assert.doesNotMatch(serialized, /Tmp-[0-9a-f]{32}/i, `${label}: secret Tmp-`);
}

function requireCreateEnvelope(data) {
  assert.ok(data && typeof data === "object", "réponse CREATE absente");
  assert.ok(data.student && typeof data.student === "object", "CREATE.student manquant");
  assert.ok(data.credentials && typeof data.credentials === "object", "CREATE.credentials manquant");
  const studentCode = String(data.student.studentCode ?? "").trim();
  const login = String(data.credentials.login ?? "").trim();
  const temporarySecret = String(data.credentials.temporarySecret ?? "").trim();
  assert.match(studentCode, /^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
  assert.equal(data.student.matricule, studentCode);
  assert.equal(data.student.loginCode, studentCode);
  assert.equal(login, studentCode);
  assert.match(temporarySecret, /^Tmp-[0-9a-f]{32}$/);
  assert.notEqual(temporarySecret, "1234");
  assert.notEqual(temporarySecret, studentCode);
  assertNoSecretLeak(data.student, "CREATE.student");
  return { student: data.student, studentCode, login, temporarySecret };
}

async function replaceTeacherAssignmentsViaApi(assignmentToken, teacherIdentifier, assignments) {
  const teacherResponse = await request("/teachers", { token: assignmentToken });
  assert.equal(teacherResponse.status, 200, JSON.stringify(teacherResponse.data));
  const teacherKey = String(teacherIdentifier).trim().toUpperCase();
  const teacher = teacherResponse.data.find((row) =>
    [row.identifier, row.teacherCode, row.publicId, row.id, row.userId].some(
      (value) => String(value ?? "").trim().toUpperCase() === teacherKey,
    ),
  );
  assert.ok(teacher, `enseignant ${teacherIdentifier} introuvable`);
  const canonicalTeacherCode = teacher.teacherCode ?? teacher.publicId ?? teacher.id;
  const desired = Array.isArray(assignments) ? assignments : [];
  const classRefs = new Set(
    desired.flatMap((assignment) => [assignment.classCode, assignment.className])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  const current = await request("/assignments", { token: assignmentToken });
  assert.equal(current.status, 200, JSON.stringify(current.data));
  for (const assignment of current.data) {
    if (!classRefs.has(String(assignment.classCode ?? "").trim()) &&
        !classRefs.has(String(assignment.className ?? "").trim())) continue;
    const removed = await request(`/assignments/${encodeURIComponent(assignment.id)}`, {
      method: "DELETE",
      token: assignmentToken,
    });
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
  }

  for (const assignment of desired.filter((row) => row.status === "active")) {
    const created = await request("/assignments", {
      method: "POST",
      token: assignmentToken,
      body: {
        teacherCode: canonicalTeacherCode,
        classCode: assignment.classCode,
        className: assignment.className,
        subjectCode: assignment.subjectCode,
        subject: assignment.subject ?? assignment.course,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
  }
}

async function createActiveClass(token, _label, scope = {}) {
  const schoolCode = scope.schoolCode ?? "CD-2026-0001";
  const countryCode = scope.countryCode ?? "CD";
  const levelName = scope.levelName ?? "6ème";
  const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");
  const groupCode = scope.groupCode ?? "A";
  const ctx = await prepareCanonicalClassContext(request, {
    schoolCode,
    countryCode,
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

async function main() {
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
    const tokenTeacher = await login("ENS-0001", "CD-2026-0001");
    const tokenPrefet = await loginWithoutPasswordGate("prefet", "CD-2026-0001");

    const activeClass = await createActiveClass(tokenCd, "Classe active", { groupCode: "E1" });
    const inactiveClass = await createActiveClass(tokenCd, "Classe à désactiver", { groupCode: "E2" });
    const patched = await request(`/classes/${encodeURIComponent(inactiveClass.classCode)}`, {
      method: "PATCH",
      token: tokenCd,
      body: { status: "inactive" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));

    const classOtherSchool = await createActiveClass(tokenBi, "Classe autre école", {
      schoolCode: "BI-2026-0002",
      countryCode: "BI",
      levelName: "5ème",
    });

    const enrolled = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Awa", lastName: "Diop", gender: "Féminin", birthDate: "2012-04-12" },
      },
    );
    assert.equal(enrolled.status, 201, JSON.stringify(enrolled.data));
    const { studentCode, temporarySecret } = requireCreateEnvelope(enrolled.data);
    assert.match(
      studentCode,
      new RegExp(`^CD-IN-${studentIdentityInitials("Diop", "Awa")}-\\d{2}-\\d{5}$`),
    );

    const usersAfterEnroll = await request("/backoffice/users", { token: tokenCd });
    assert.equal(usersAfterEnroll.status, 200, JSON.stringify(usersAfterEnroll.data));
    const studentAccount = (usersAfterEnroll.data ?? []).find(
      (row) =>
        String(row.publicId ?? "") === studentCode ||
        String(row.identityCode ?? "") === studentCode ||
        String(row.linkedStudent?.studentCode ?? "") === studentCode,
    );
    assert.ok(studentAccount, `compte technique élève attendu pour ${studentCode}`);
    assert.equal(studentAccount.accountKind, "student_login");
    assert.equal(studentAccount.businessProfileLabel, "Compte lié à un élève");
    assert.equal(studentAccount.linkedStudent?.studentCode, studentCode);
    assert.notEqual(studentAccount.businessProfileLabel, "Sans affectation");
    assert.equal(studentAccount.linkedTeacher, null);
    // Inscription pose students.user_id : grant Enseignant = STUDENT_ROLE_LOCKED
    // (BUSINESS_PROFILE_CONFLICT reste le cas code-match sans FK).
    const blockedTeacher = await request(`/backoffice/users/${encodeURIComponent(studentAccount.id)}/roles/grant`, {
      method: "POST",
      token: tokenCd,
      body: { role: "Enseignant" },
    });
    assert.equal(blockedTeacher.status, 409, JSON.stringify(blockedTeacher.data));
    assert.equal(blockedTeacher.data.code, "STUDENT_ROLE_LOCKED");
    assert.match(String(blockedTeacher.data.message ?? ""), /ne peuvent pas être modifiés/);
    const teachersAfterBlock = await request("/teachers", { token: tokenCd });
    assert.equal(teachersAfterBlock.status, 200);
    assert.equal(
      (teachersAfterBlock.data ?? []).some((row) => String(row.userId) === String(studentAccount.id)),
      false,
      "aucune fiche enseignant créée pour le compte élève",
    );

    const alphaPhone = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Nia", lastName: "Kone", parentPhone: "Baudouin OKITO" },
      },
    );
    assert.equal(alphaPhone.status, 400, JSON.stringify(alphaPhone.data));
    assert.match(String(alphaPhone.data?.message ?? ""), /parentPhone invalide/i);

    const plus243 = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Lia", lastName: "Mbala", parentPhone: "+243 820 000 111" },
      },
    );
    assert.equal(plus243.status, 201, JSON.stringify(plus243.data));
    requireCreateEnvelope(plus243.data);

    const plus33 = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Léa", lastName: "Martin", parentPhone: "+33 6 12 34 56 78" },
      },
    );
    assert.equal(plus33.status, 201, JSON.stringify(plus33.data));
    requireCreateEnvelope(plus33.data);

    const emptyPhone = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: { firstName: "Empty", lastName: "Phone" },
      },
    );
    assert.equal(emptyPhone.status, 201, JSON.stringify(emptyPhone.data));
    requireCreateEnvelope(emptyPhone.data);

    const esther = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      {
        method: "POST",
        token: tokenCd,
        body: {
          firstName: "ESTHER",
          lastName: "OKITO",
          gender: "Féminin",
          birthDate: "2010-03-05",
        },
      },
    );
    assert.equal(esther.status, 201, JSON.stringify(esther.data));
    const estherEnvelope = requireCreateEnvelope(esther.data);
    assert.match(
      estherEnvelope.studentCode,
      new RegExp(`^CD-IN-${studentIdentityInitials("OKITO", "ESTHER")}-\\d{2}-\\d{5}$`),
    );

    const listed = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      { token: tokenCd },
    );
    assert.equal(listed.status, 200);
    assert.ok(listed.data.some((row) => row.studentCode === studentCode));
    listed.data.forEach((row) => assertNoSecretLeak(row, "GET class students"));

    const directory = await request("/students", { token: tokenCd });
    assert.equal(directory.status, 200, JSON.stringify(directory.data));
    const directoryRows = Array.isArray(directory.data) ? directory.data : [];
    assert.ok(directoryRows.some((row) => row.studentCode === studentCode));
    directoryRows.forEach((row) => assertNoSecretLeak(row, "GET /students"));

    const fetched = await request(`/students/${encodeURIComponent(studentCode)}`, {
      token: tokenCd,
    });
    assert.equal(fetched.status, 200, JSON.stringify(fetched.data));
    assert.equal(fetched.data.classCode, activeClass.classCode);
    assertNoSecretLeak(fetched.data, "GET /students/:id");

    const exported = await request("/data-export", { token: tokenCd });
    if (exported.status === 200) {
      assertNoSecretLeak(exported.data, "GET /data-export");
      const serializedExport = JSON.stringify(exported.data ?? null);
      assert.doesNotMatch(serializedExport, new RegExp(temporarySecret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    const studentLogin = await request("/backoffice/login", {
      method: "POST",
      body: {
        identifier: studentCode,
        password: temporarySecret,
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(studentLogin.status, 200, JSON.stringify(studentLogin.data));
    assert.equal(studentLogin.data.user.mustChangePassword, true);
    assertNoSecretLeak(studentLogin.data.user, "login.user");
    const studentToken = studentLogin.data.accessToken || studentLogin.data.token;
    assert.ok(studentToken);

    const changed = await request("/auth/change-password", {
      method: "POST",
      token: studentToken,
      body: { currentPassword: temporarySecret, newPassword: "StudentPass12" },
    });
    assert.ok(changed.status >= 200 && changed.status < 300, JSON.stringify(changed.data));
    assert.equal(changed.data.user?.mustChangePassword, false);

    const oldSecretLogin = await request("/backoffice/login", {
      method: "POST",
      body: {
        identifier: studentCode,
        password: temporarySecret,
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(oldSecretLogin.status, 401, JSON.stringify(oldSecretLogin.data));

    const rotatedLogin = await request("/backoffice/login", {
      method: "POST",
      body: {
        identifier: studentCode,
        password: "StudentPass12",
        schoolCode: "CD-2026-0001",
      },
    });
    assert.equal(rotatedLogin.status, 200, JSON.stringify(rotatedLogin.data));
    assert.equal(rotatedLogin.data.user.mustChangePassword, false);

    const superLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "superadmin", password: "1234" },
    });
    assert.equal(superLogin.status, 200, JSON.stringify(superLogin.data));
    const superToken = superLogin.data.accessToken || superLogin.data.token;
    const audit = await request(
      `/audit?action=enroll_student&schoolCode=${encodeURIComponent("CD-2026-0001")}`,
      { token: superToken },
    );
    assert.equal(
      audit.status,
      403,
      `GET /audit établissement interdit au Superadmin (#503): ${JSON.stringify(audit.data)}`,
    );
    assert.ok(
      audit.data?.code === "PLATFORM_PERSONAL_DATA_DENIED" || audit.data?.code === "PERMISSION_DENIED",
      JSON.stringify(audit.data),
    );

    const enrolledOther = await request(
      `/classes/${encodeURIComponent(classOtherSchool.classCode)}/students`,
      {
        method: "POST",
        token: tokenBi,
        body: { firstName: "Ibra", lastName: "Fall" },
      },
    );
    assert.equal(enrolledOther.status, 201, JSON.stringify(enrolledOther.data));
    const otherCreated = requireCreateEnvelope(enrolledOther.data);
    assert.equal(
      otherCreated.studentCode.split("-")[2],
      studentIdentityInitials("Fall", "Ibra"),
    );
    assert.notEqual(studentCode, otherCreated.studentCode);
    assert.notEqual(temporarySecret, otherCreated.temporarySecret);

    // Enseignant hors classe affectée (seed sans classCode sur cette classe) : refus.
    const teacherListDenied = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      { token: tokenTeacher },
    );
    assert.equal(teacherListDenied.status, 403, JSON.stringify(teacherListDenied.data));

    const teacherStudentDenied = await request(
      `/students/${encodeURIComponent(studentCode)}`,
      { token: tokenTeacher },
    );
    assert.equal(teacherStudentDenied.status, 404, JSON.stringify(teacherStudentDenied.data));

    // Année scolaire inconnue : refus (pas de fabrication automatique).
    const unknownYear = await request("/classes", {
      method: "POST",
      token: tokenCd,
      body: {
        academicYearId: "missing-year-id",
        levelId: "missing-level-id",
        groupId: "missing-group-id",
        status: "active",
      },
    });
    assert.equal(unknownYear.status, 400, JSON.stringify(unknownYear.data));

    // Connexion réelle : affectation active + classCode → 200 avant et après refresh.
    await replaceTeacherAssignmentsViaApi(tokenPrefet, "ENS-0001", [
      {
        className: activeClass.name,
        classCode: activeClass.classCode,
        course: "Mathématiques",
        status: "active",
      },
    ]);
    const activeTeacherSession = await loginSession("ENS-0001", "CD-2026-0001");
    const teacherReadBeforeRefresh = await request(
      `/students/${encodeURIComponent(studentCode)}`,
      { token: activeTeacherSession.token },
    );
    assert.equal(
      teacherReadBeforeRefresh.status,
      200,
      JSON.stringify(teacherReadBeforeRefresh.data),
    );
    const teacherRosterBeforeRefresh = await request(
      `/classes/${encodeURIComponent(activeClass.classCode)}/students`,
      { token: activeTeacherSession.token },
    );
    assert.equal(
      teacherRosterBeforeRefresh.status,
      200,
      JSON.stringify(teacherRosterBeforeRefresh.data),
    );

    const tokenAfterRefresh = await refreshAccessToken(activeTeacherSession.refreshToken);
    const teacherReadAfterRefresh = await request(
      `/students/${encodeURIComponent(studentCode)}`,
      { token: tokenAfterRefresh },
    );
    assert.equal(
      teacherReadAfterRefresh.status,
      200,
      JSON.stringify(teacherReadAfterRefresh.data),
    );

    // Affectation retirée avant refresh → accès refusé après refresh.
    await replaceTeacherAssignmentsViaApi(tokenPrefet, "ENS-0001", [
      {
        className: activeClass.name,
        classCode: activeClass.classCode,
        course: "Mathématiques",
        status: "inactive",
      },
    ]);
    const tokenAfterInactiveRefresh = await refreshAccessToken(activeTeacherSession.refreshToken);
    const teacherReadAfterInactive = await request(
      `/students/${encodeURIComponent(studentCode)}`,
      { token: tokenAfterInactiveRefresh },
    );
    assert.equal(
      teacherReadAfterInactive.status,
      404,
      JSON.stringify(teacherReadAfterInactive.data),
    );

    // Connexion réelle avec affectation inactive → refus.
    const inactiveLogin = await loginSession("ENS-0001", "CD-2026-0001");
    const teacherInactiveLoginDenied = await request(
      `/students/${encodeURIComponent(studentCode)}`,
      { token: inactiveLogin.token },
    );
    assert.equal(
      teacherInactiveLoginDenied.status,
      404,
      JSON.stringify(teacherInactiveLoginDenied.data),
    );

    // Le client ne peut pas créer une affectation sans statut actif → refus fail-closed.
    await replaceTeacherAssignmentsViaApi(tokenPrefet, "ENS-0001", [
      {
        className: activeClass.name,
        classCode: activeClass.classCode,
        course: "Mathématiques",
      },
    ]);
    const missingStatusLogin = await loginSession("ENS-0001", "CD-2026-0001");
    const teacherMissingStatusDenied = await request(
      `/students/${encodeURIComponent(studentCode)}`,
      { token: missingStatusLogin.token },
    );
    assert.equal(
      teacherMissingStatusDenied.status,
      404,
      JSON.stringify(teacherMissingStatusDenied.data),
    );
    const tokenMissingStatusRefresh = await refreshAccessToken(missingStatusLogin.refreshToken);
    const teacherMissingStatusAfterRefresh = await request(
      `/students/${encodeURIComponent(studentCode)}`,
      { token: tokenMissingStatusRefresh },
    );
    assert.equal(
      teacherMissingStatusAfterRefresh.status,
      404,
      JSON.stringify(teacherMissingStatusAfterRefresh.data),
    );

    // Homonymes inter-années (fixture 2024-2025 explicite) + principal classNames seuls.
    const { prepareCanonicalClassContext, postCanonicalClass, ensureSchoolYear } = require("../lib/canonicalClassHttp");
    const offering = await prepareCanonicalClassContext(request, {
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      groupCode: "H1",
    });
    const priorYearRow = await ensureSchoolYear(request, tokenCd, "2024-2025", "CD-2026-0001", {
      isCurrent: false,
    });
    const priorYear = await postCanonicalClass(request, tokenCd, {
      academicYearId: priorYearRow.id,
      levelId: offering.level.id,
      groupId: offering.group.id,
      status: "active",
    });
    assert.equal(priorYear.status, 201, JSON.stringify(priorYear.data));
    const currentHomonym = await postCanonicalClass(request, tokenCd, {
      academicYearId: offering.academicYear.id,
      levelId: offering.level.id,
      groupId: offering.group.id,
      status: "active",
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
    const homonymCreated = requireCreateEnvelope(enrolledHomonym.data);
    assert.equal(
      homonymCreated.studentCode.split("-")[2],
      studentIdentityInitials("Nyme", "Homo"),
    );

    await replaceTeacherAssignmentsViaApi(tokenPrefet, "ENS-0001", [
      {
        classCode: priorYear.data.classCode,
        className: priorYear.data.name,
        course: "Mathématiques",
        status: "inactive",
      },
    ]);
    const nameOnlyLogin = await loginSession("ENS-0001", "CD-2026-0001");
    const teacherNameOnlyStudentDenied = await request(
      `/students/${encodeURIComponent(homonymCreated.studentCode)}`,
      { token: nameOnlyLogin.token },
    );
    assert.equal(
      teacherNameOnlyStudentDenied.status,
      404,
      JSON.stringify(teacherNameOnlyStudentDenied.data),
    );
    const teacherNameOnlyRosterDenied = await request(
      `/classes/${encodeURIComponent(currentHomonym.data.classCode)}/students`,
      { token: nameOnlyLogin.token },
    );
    assert.equal(
      teacherNameOnlyRosterDenied.status,
      403,
      JSON.stringify(teacherNameOnlyRosterDenied.data),
    );

    // Parent : pas de dossier d'un autre élève du même établissement.
    const tokenParent = await login("+243 820 000 001", "CD-2026-0001");
    const parentOtherStudentDenied = await request(
      `/students/${encodeURIComponent(studentCode)}`,
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
      requireCreateEnvelope(result.data);
      assert.equal(
        result.data.student.studentCode.split("-")[2],
        studentIdentityInitials("Parallel", result.data.student.firstName),
      );
    }
    const concurrentCodes = new Set(concurrent.map((item) => item.data.student.studentCode));
    const concurrentSecrets = new Set(concurrent.map((item) => item.data.credentials.temporarySecret));
    assert.equal(concurrentCodes.size, 3);
    assert.equal(concurrentSecrets.size, 3);

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
