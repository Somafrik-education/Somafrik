"use strict";

/**
 * Vérification API création enseignant + compte (mémoire) :
 * création + relecture, login, mustChangePassword, authz, isolation,
 * falsification tenant, ambiguïté, homonymes, idempotence, non-régression classes/élèves.
 */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

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

async function loginWithoutPasswordGate(identifier, schoolCode, password = "1234") {
  const session = await login(identifier, schoolCode, password);
  if (!session.user?.mustChangePassword) return session;
  const nextPassword = "PrefetPass12";
  const changed = await request("/auth/change-password", {
    method: "POST",
    token: session.token,
    body: { currentPassword: password, newPassword: nextPassword },
  });
  assert.ok(changed.status >= 200 && changed.status < 300, JSON.stringify(changed.data));
  return login(identifier, schoolCode, nextPassword);
}

async function createTeacherViaUsers(token, payload) {
  const user = await request("/backoffice/users", {
    method: "POST",
    token,
    body: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      birthDate: payload.birthDate,
      phone: payload.phone,
      email: payload.email,
      gender: payload.gender,
      temporaryPassword: payload.temporaryPassword,
    },
  });
  assert.equal(user.status, 201, `create user ${JSON.stringify(user.data)}`);
  const granted = await request(`/backoffice/users/${encodeURIComponent(user.data.id)}/roles/grant`, {
    method: "POST",
    token,
    body: { role: "Enseignant" },
  });
  assert.equal(granted.status, 200, `grant teacher ${JSON.stringify(granted.data)}`);
  const listed = await request("/teachers", { token });
  assert.equal(listed.status, 200, JSON.stringify(listed.data));
  const teacher = (listed.data ?? []).find((row) => String(row.userId) === String(user.data.id));
  assert.ok(teacher, "profil enseignant attendu après GRANT Enseignant");
  return {
    status: 201,
    data: {
      ...teacher,
      mustChangePassword: true,
      userId: user.data.id,
    },
  };
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
    const prefet = await loginWithoutPasswordGate("prefet", "CD-2026-0001");

    const adminEffective = await request("/auth/effective-permissions", { token: admin.token });
    assert.equal(adminEffective.status, 200, JSON.stringify(adminEffective.data));
    assert.ok(
      Array.isArray(adminEffective.data.permissions) &&
        adminEffective.data.permissions.includes("Affectations:CREATE"),
      JSON.stringify(adminEffective.data.permissions),
    );
    assert.equal(
      adminEffective.data.permissions.includes("Affectations:DELETE"),
      false,
      "SCHOOL_ADMIN ne doit pas avoir Affectations:DELETE par défaut",
    );
    const prefetEffective = await request("/auth/effective-permissions", { token: prefet.token });
    assert.equal(prefetEffective.status, 200, JSON.stringify(prefetEffective.data));
    assert.ok(
      Array.isArray(prefetEffective.data.permissions) &&
        prefetEffective.data.permissions.includes("Affectations:DELETE"),
      JSON.stringify(prefetEffective.data.permissions),
    );

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

    const blockedCreate = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload(),
    });
    assert.equal(blockedCreate.status, 403, JSON.stringify(blockedCreate.data));
    assert.equal(blockedCreate.data.code, "TEACHER_IDENTITY_MUST_COME_FROM_USERS");

    const created = await createTeacherViaUsers(admin.token, teacherPayload());
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.match(String(created.data.teacherCode), /ENS-\d{4}$/);
    assert.equal(created.data.identifier.startsWith("ENS-"), true);
    assert.equal(created.data.mustChangePassword, true);

    const replay = await request("/teachers", {
      method: "POST",
      token: admin.token,
      body: teacherPayload(),
    });
    assert.equal(replay.status, 403, JSON.stringify(replay.data));

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
    const homonym = await createTeacherViaUsers(
      admin.token,
      teacherPayload({
        birthDate: "1988-01-01",
        phone: "+243 811 000 002",
        temporaryPassword: "TempPass2",
      }),
    );
    assert.equal(homonym.status, 201, JSON.stringify(homonym.data));
    assert.notEqual(homonym.data.teacherCode, created.data.teacherCode);

    // Identité canonique ambiguë refusée
    const ambiguous = await request("/backoffice/users", {
      method: "POST",
      token: admin.token,
      body: {
        firstName: "Fatou",
        lastName: "Sow",
        birthDate: "1990-05-01",
        phone: "+243 811 000 003",
        temporaryPassword: "TempPass3",
      },
    });
    assert.equal(ambiguous.status, 201, JSON.stringify(ambiguous.data));
    const ambiguousGrant = await request(`/backoffice/users/${encodeURIComponent(ambiguous.data.id)}/roles/grant`, {
      method: "POST",
      token: admin.token,
      body: { role: "Enseignant" },
    });
    assert.equal(ambiguousGrant.status, 409, JSON.stringify(ambiguousGrant.data));
    assert.equal(ambiguousGrant.data.code, "TEACHER_PROFILE_AMBIGUOUS");

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
    assert.equal(futureBirth.status, 403);
    assert.equal(futureBirth.data.code, "TEACHER_IDENTITY_MUST_COME_FROM_USERS");

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
    assert.equal(underage.status, 403);

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
    assert.equal(forged.status, 403);

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
    const { prepareCanonicalClassContext, postCanonicalClass } = require("../lib/canonicalClassHttp");
    const offering = await prepareCanonicalClassContext(request, {
      schoolCode: "CD-2026-0001",
      countryCode: "CD",
      groupCode: "PR",
    });
    const classCreated = await postCanonicalClass(request, admin.token, {
      academicYearId: offering.academicYear.id,
      levelId: offering.level.id,
      groupId: offering.group.id,
      status: "active",
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

    // LOT 3 — CRUD affectations dédié + projection state PostgreSQL.
    const assignmentsBefore = await request("/assignments", { token: admin.token });
    assert.equal(assignmentsBefore.status, 200, JSON.stringify(assignmentsBefore.data));
    const seedAssignment = assignmentsBefore.data[0];
    assert.ok(seedAssignment?.id, "affectation seed attendue");

    const seedSubject = seedAssignment.subject || seedAssignment.course;
    let retiredCollisionCount = 0;
    for (; retiredCollisionCount < 100; retiredCollisionCount += 1) {
      const currentAssignments = await request("/assignments", { token: admin.token });
      assert.equal(currentAssignments.status, 200, JSON.stringify(currentAssignments.data));
      const collision = currentAssignments.data.find(
        (row) =>
          row.className === seedAssignment.className &&
          (row.subject || row.course) === seedSubject,
      );
      if (!collision) break;
      const adminDenied = await request(
        `/assignments/${encodeURIComponent(collision.id)}`,
        { method: "DELETE", token: admin.token },
      );
      assert.equal(adminDenied.status, 403, JSON.stringify(adminDenied.data));
      const retired = await request(
        `/assignments/${encodeURIComponent(collision.id)}`,
        { method: "DELETE", token: prefet.token },
      );
      assert.equal(retired.status, 200, JSON.stringify(retired.data));
    }
    assert.ok(retiredCollisionCount > 0, "collision seed attendue");
    assert.ok(retiredCollisionCount < 100, "purge des collisions affectation bornée");

    const assignmentCreated = await request("/assignments", {
      method: "POST",
      token: admin.token,
      body: {
        teacherCode: created.data.teacherCode,
        className: seedAssignment.className,
        subject: seedSubject,
      },
    });
    assert.equal(assignmentCreated.status, 201, JSON.stringify(assignmentCreated.data));
    assert.equal(assignmentCreated.data.teacherCode, created.data.teacherCode);

    const assignmentUpdated = await request(
      `/assignments/${encodeURIComponent(assignmentCreated.data.id)}`,
      {
        method: "PATCH",
        token: admin.token,
        body: { teacherCode: homonym.data.teacherCode },
      },
    );
    assert.equal(assignmentUpdated.status, 200, JSON.stringify(assignmentUpdated.data));
    assert.equal(assignmentUpdated.data.teacherCode, homonym.data.teacherCode);

    const teachersList = await request("/teachers", { token: admin.token });
    assert.equal(teachersList.status, 200, JSON.stringify(teachersList.data));
    assert.ok(
      (teachersList.data ?? []).some(
        (row) => String(row.id ?? row.teacherCode ?? row.publicId) === homonym.data.teacherCode,
      ),
      "GET /teachers projette PostgreSQL",
    );

    const assignmentsList = await request("/assignments", { token: admin.token });
    assert.equal(assignmentsList.status, 200, JSON.stringify(assignmentsList.data));
    assert.ok(
      (assignmentsList.data ?? []).some(
        (row) => String(row.id) === String(assignmentCreated.data.id),
      ),
      "GET /assignments projette PostgreSQL",
    );

    const teachersPut = await request("/backoffice/state", {
      method: "PUT",
      token: admin.token,
      body: { teachers: [] },
    });
    assertBackOfficeStateWriteRemoved(teachersPut, "teachers");

    const assignmentsPut = await request("/backoffice/state", {
      method: "PUT",
      token: admin.token,
      body: { assignments: null },
    });
    assertBackOfficeStateWriteRemoved(assignmentsPut, "assignments");

    const sentinelId = `USER-LOT3-${Date.now()}`;
    const usersBeforeMixed = await request("/backoffice/users", { token: admin.token });
    assert.equal(usersBeforeMixed.status, 200, JSON.stringify(usersBeforeMixed.data));
    const mixedPut = await request("/backoffice/state", {
      method: "PUT",
      token: admin.token,
      body: {
        assignments: assignmentsList.data,
        users: [
          ...(usersBeforeMixed.data ?? []),
          { id: sentinelId, name: "Sentinel LOT 3", schoolCode: "CD-2026-0001" },
        ],
      },
    });
    assertBackOfficeStateWriteRemoved(mixedPut, "mixed staff");
    const usersAfterMixed = await request("/backoffice/users", { token: admin.token });
    assert.equal(usersAfterMixed.status, 200, JSON.stringify(usersAfterMixed.data));
    assert.equal(
      (usersAfterMixed.data ?? []).some((row) => String(row.id) === sentinelId),
      false,
      "aucune mutation partielle sur PUT staff mixte",
    );

    const assignmentDeleted = await request(
      `/assignments/${encodeURIComponent(assignmentCreated.data.id)}`,
      { method: "DELETE", token: prefet.token },
    );
    assert.equal(assignmentDeleted.status, 200, JSON.stringify(assignmentDeleted.data));
    const assignmentsAfterDelete = await request("/assignments", { token: admin.token });
    assert.equal(assignmentsAfterDelete.status, 200, JSON.stringify(assignmentsAfterDelete.data));
    assert.equal(
      assignmentsAfterDelete.data.some(
        (row) => String(row.id) === String(assignmentCreated.data.id),
      ),
      false,
      "l'affectation modifiée puis supprimée ne doit pas survivre en mémoire",
    );

    const assignmentRecreated = await request("/assignments", {
      method: "POST",
      token: admin.token,
      body: {
        teacherCode: created.data.teacherCode,
        className: seedAssignment.className,
        subject: seedSubject,
      },
    });
    assert.equal(assignmentRecreated.status, 201, JSON.stringify(assignmentRecreated.data));
    assert.notEqual(String(assignmentRecreated.data.id), String(assignmentCreated.data.id));

    const patched = await request(`/teachers/${encodeURIComponent(created.data.teacherCode)}`, {
      method: "PATCH",
      token: admin.token,
      body: { speciality: "Géographie", firstName: "Fatou", email: "fatou.sow@example.com" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.data));
    assert.equal(patched.data.firstName, "Fatou");
    assert.equal(patched.data.speciality, "Géographie");

    const forgedPatch = await request(`/teachers/${encodeURIComponent(created.data.teacherCode)}`, {
      method: "PATCH",
      token: admin.token,
      body: { schoolCode: "BI-2026-0002", speciality: "Hack" },
    });
    assert.equal(forgedPatch.status, 400, JSON.stringify(forgedPatch.data));

    const teacherPatch = await request(`/teachers/${encodeURIComponent(created.data.teacherCode)}`, {
      method: "PATCH",
      token: teacherSeed.token,
      body: { speciality: "Hack" },
    });
    assert.equal(teacherPatch.status, 403, JSON.stringify(teacherPatch.data));

    const crossPatch = await request(`/teachers/${encodeURIComponent(created.data.teacherCode)}`, {
      method: "PATCH",
      token: adminBi.token,
      body: { speciality: "Hack" },
    });
    assert.equal(crossPatch.status, 404, JSON.stringify(crossPatch.data));

    const emailClash = await request(`/teachers/${encodeURIComponent(homonym.data.teacherCode)}`, {
      method: "PATCH",
      token: admin.token,
      body: { email: "fatou.sow@example.com" },
    });
    assert.equal(emailClash.status, 409, JSON.stringify(emailClash.data));

    const phoneClash = await request(`/teachers/${encodeURIComponent(homonym.data.teacherCode)}`, {
      method: "PATCH",
      token: admin.token,
      body: { phone: teacherPayload().phone },
    });
    assert.equal(phoneClash.status, 409, JSON.stringify(phoneClash.data));

    const civilClash = await request(`/teachers/${encodeURIComponent(homonym.data.teacherCode)}`, {
      method: "PATCH",
      token: admin.token,
      body: { firstName: "Fatou", lastName: "Sow", birthDate: "1990-05-01" },
    });
    assert.equal(civilClash.status, 409, JSON.stringify(civilClash.data));
    assert.equal(civilClash.data.code, "TEACHER_CANON_AMBIGUOUS");

    const teacherDelete = await request(`/teachers/${encodeURIComponent(homonym.data.teacherCode)}`, {
      method: "DELETE",
      token: teacherSeed.token,
    });
    assert.equal(teacherDelete.status, 403, JSON.stringify(teacherDelete.data));

    const adminDelete = await request(`/teachers/${encodeURIComponent(homonym.data.teacherCode)}`, {
      method: "DELETE",
      token: admin.token,
    });
    assert.equal(adminDelete.status, 403, JSON.stringify(adminDelete.data));

    const missingDelete = await request("/teachers/CD-2026-0001-ENS-9999", {
      method: "DELETE",
      token: prefet.token,
    });
    assert.equal(missingDelete.status, 404, JSON.stringify(missingDelete.data));

    const archived = await request(`/teachers/${encodeURIComponent(created.data.teacherCode)}`, {
      method: "DELETE",
      token: prefet.token,
    });
    assert.equal(archived.status, 200, JSON.stringify(archived.data));
    assert.equal(archived.data.archived, true);
    assert.equal(archived.data.teacherCode, created.data.teacherCode);

    const listedAfterArchive = await request("/teachers", { token: admin.token });
    assert.equal(listedAfterArchive.status, 200);
    assert.equal(
      listedAfterArchive.data.some((row) => row.teacherCode === created.data.teacherCode),
      false,
      "enseignant archivé absent de la liste active",
    );
    const getArchived = await request(`/teachers/${encodeURIComponent(created.data.teacherCode)}`, {
      token: admin.token,
    });
    assert.equal(getArchived.status, 404, JSON.stringify(getArchived.data));

    const assignArchived = await request("/assignments", {
      method: "POST",
      token: admin.token,
      body: {
        teacherCode: created.data.teacherCode,
        className: seedAssignment.className,
        subject: seedSubject,
      },
    });
    assert.equal(assignArchived.status, 404, JSON.stringify(assignArchived.data));
    assert.equal(assignArchived.data.code, "ASSIGNMENT_TEACHER_NOT_FOUND");

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
