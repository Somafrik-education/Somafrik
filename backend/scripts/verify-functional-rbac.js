"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

const ROOT = require("node:path").resolve(__dirname, "../..");
const PORT = 19745;
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
  return result.data.accessToken || result.data.token;
}

async function main() {
  const child = spawn("node", ["backend/scripts/dev-memory.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", SOMAFRIK_DB_REQUIRED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(child);
    const superToken = await login("superadmin", "1234");
    const countryToken = await login("admin-rdc", "1234");
    const schoolToken = await login("admin", "1234", "CD-IN-26-001");
    const prefetLogin = await request("/backoffice/login", {
      method: "POST",
      body: { identifier: "prefet", password: "1234", schoolCode: "CD-IN-26-001" },
    });
    assert.equal(prefetLogin.status, 200, JSON.stringify(prefetLogin.data));
    let prefetToken = prefetLogin.data.accessToken || prefetLogin.data.token;
    const changed = await request("/auth/change-password", {
      method: "POST",
      token: prefetToken,
      body: { newPassword: "Prefet#2026Aa" },
    });
    assert.ok([200, 201].includes(changed.status), JSON.stringify(changed.data));
    prefetToken = changed.data?.accessToken || (await login("prefet", "Prefet#2026Aa", "CD-IN-26-001"));

    const catalog = await request("/backoffice/rbac/catalog", { token: superToken });
    assert.equal(catalog.status, 200, JSON.stringify(catalog.data));
    assert.ok(Array.isArray(catalog.data.roles));
    assert.ok(catalog.data.roles.some((row) => row.roleCode === "PREFET_ETUDES" || row.roleName === "Préfet des études"));
    assert.ok(catalog.data.modules.some((row) => row.moduleKey === "students"));
    assert.ok(catalog.data.modules.some((row) => row.moduleKey === "assignments"));
    const attendanceModule = catalog.data.modules.find((row) => row.moduleKey === "attendance");
    assert.ok(attendanceModule, "module Présences dans le catalogue");
    assert.deepEqual(attendanceModule.dependencies?.create, ["read"]);
    assert.equal(catalog.data.mandatoryByRole?.SUPER_ADMIN?.users?.read, true);
    assert.deepEqual(catalog.data.mandatoryByRole?.SCHOOL_ADMIN || {}, {});

    const schoolEffective = await request("/auth/effective-permissions", { token: schoolToken });
    assert.equal(schoolEffective.status, 200, JSON.stringify(schoolEffective.data));
    assert.ok(
      Array.isArray(schoolEffective.data.permissions) &&
        schoolEffective.data.permissions.includes("Affectations:CREATE"),
      JSON.stringify(schoolEffective.data.permissions),
    );
    assert.equal(
      schoolEffective.data.permissions.includes("Affectations:DELETE"),
      false,
      "SCHOOL_ADMIN ne doit pas avoir Affectations:DELETE par défaut",
    );

    const subjectsCatalog = await request("/v2/subjects", { token: schoolToken });
    assert.notEqual(subjectsCatalog.status, 403, JSON.stringify(subjectsCatalog.data));
    assert.ok(
      subjectsCatalog.status === 200,
      `GET /v2/subjects attendu 200, reçu ${subjectsCatalog.status} ${JSON.stringify(subjectsCatalog.data)}`,
    );

    const secretaryToken = await login("secretaire", "1234", "CD-IN-26-001");
    const secretaryDenied = await request("/assignments", {
      method: "POST",
      token: secretaryToken,
      body: { teacherCode: "CD-IN-JK-26-00001", classCode: "CLS-6A", subjectCode: "SUB-MATH" },
    });
    assert.equal(secretaryDenied.status, 403, JSON.stringify(secretaryDenied.data));

    const countryWrite = await request("/backoffice/rbac/permissions", {
      method: "PATCH",
      token: countryToken,
      body: {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-IN-26-001",
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
      },
    });
    assert.equal(countryWrite.status, 403, JSON.stringify(countryWrite.data));

    const schoolWrite = await request("/backoffice/rbac/permissions", {
      method: "PATCH",
      token: schoolToken,
      body: {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-IN-26-001",
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
      },
    });
    assert.equal(schoolWrite.status, 403, JSON.stringify(schoolWrite.data));

    const prefetWrite = await request("/backoffice/rbac/permissions", {
      method: "PATCH",
      token: prefetToken,
      body: {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-IN-26-001",
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
      },
    });
    assert.equal(prefetWrite.status, 403, JSON.stringify(prefetWrite.data));

    const legacyPut = await request("/backoffice/role-permissions", {
      method: "PUT",
      token: superToken,
      body: { "Préfet des études": ["Élèves:DELETE"] },
    });
    assert.equal(legacyPut.status, 403, JSON.stringify(legacyPut.data));
    assert.equal(legacyPut.data?.code, "LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN");

    const saved = await request("/backoffice/rbac/permissions", {
      method: "PATCH",
      token: superToken,
      body: {
        roleKey: "PREFET_ETUDES",
        countryCode: "CD",
        schoolCode: "CD-IN-26-001",
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));

    const denied = await request("/students/CD-IN-EL-26-001", { method: "DELETE", token: prefetToken });
    const effective = await request("/auth/effective-permissions", { token: prefetToken });
    assert.equal(effective.status, 200, JSON.stringify(effective.data));
    assert.equal(
      Array.isArray(effective.data.permissions) && effective.data.permissions.includes("Élèves:DELETE"),
      false,
      JSON.stringify(effective.data.permissions),
    );
    assert.equal(denied.status, 403, JSON.stringify({ denied: denied.data, effective: effective.data }));

    const configured = await request(
      `/backoffice/rbac/permissions?roleKey=PREFET_ETUDES&schoolCode=${encodeURIComponent("CD-IN-26-001")}`,
      { token: superToken },
    );
    assert.equal(configured.status, 200, JSON.stringify(configured.data));
    const restored = await request("/backoffice/rbac/permissions", {
      method: "PATCH",
      token: superToken,
      body: {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-IN-26-001",
        expectedUpdatedAt: configured.data.updatedAt,
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: true }],
      },
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.data));

    const afterRestore = await request("/auth/effective-permissions", { token: prefetToken });
    const configuredAfter = await request(
      `/backoffice/rbac/permissions?roleKey=PREFET_ETUDES&countryCode=CD&schoolCode=${encodeURIComponent("CD-IN-26-001")}`,
      { token: superToken },
    );
    const allowed = await request("/students/CD-IN-EL-26-001", { method: "DELETE", token: prefetToken });
    assert.ok(
      [200, 204, 404].includes(allowed.status),
      JSON.stringify({
        allowed: allowed.data,
        restored: restored.data,
        afterRestore: afterRestore.data,
        configuredAfter: configuredAfter.data,
      }),
    );
    assert.notEqual(allowed.status, 403);

    async function latestSchoolMatrixUpdatedAt() {
      const current = await request(
        `/backoffice/rbac/permissions?roleKey=PREFET_ETUDES&countryCode=CD&schoolCode=${encodeURIComponent("CD-IN-26-001")}`,
        { token: superToken },
      );
      assert.equal(current.status, 200, JSON.stringify(current.data));
      return current.data.updatedAt;
    }

    async function patchAttendance(flags) {
      const payload = {
        roleKey: "PREFET_ETUDES",
        countryCode: "CD",
        schoolCode: "CD-IN-26-001",
        expectedUpdatedAt: await latestSchoolMatrixUpdatedAt(),
        grants: [{ moduleKey: "attendance", ...flags }],
      };
      const result = await request("/backoffice/rbac/permissions", {
        method: "PATCH",
        token: superToken,
        body: payload,
      });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      return result.data.updatedAt;
    }

    const presencePayload = {
      className: "6ème A",
      date: "17/08/2026",
      hour: "08:00",
      items: [
        {
          studentId: "CD-IN-EL-26-001",
          className: "6ème A",
          date: "17/08/2026",
          present: true,
          status: "Présent",
        },
      ],
    };

    await patchAttendance({ canCreate: false, canRead: true, canUpdate: false, canDelete: false });
    const deniedWrite = await request("/presences", {
      method: "POST",
      token: prefetToken,
      body: presencePayload,
    });
    assert.equal(deniedWrite.status, 403, JSON.stringify(deniedWrite.data));
    assert.equal(deniedWrite.data?.code, "PERMISSION_DENIED");

    const liveBefore = await request("/auth/effective-permissions", { token: prefetToken });
    assert.equal(liveBefore.data?.permissions?.includes("Présences:CREATE"), false);

    await patchAttendance({ canCreate: true, canRead: true, canUpdate: false, canDelete: false });
    const liveGranted = await request("/auth/effective-permissions", { token: prefetToken });
    assert.ok(
      liveGranted.data?.permissions?.includes("Présences:CREATE"),
      JSON.stringify(liveGranted.data?.permissions),
    );
    const allowedWrite = await request("/presences", {
      method: "POST",
      token: prefetToken,
      body: presencePayload,
    });
    assert.notEqual(allowedWrite.status, 403, JSON.stringify(allowedWrite.data));
    assert.ok(
      [200, 201, 400, 404, 409].includes(allowedWrite.status),
      `POST après grant: ${allowedWrite.status} ${JSON.stringify(allowedWrite.data)}`,
    );

    await patchAttendance({ canCreate: false, canRead: true, canUpdate: true, canDelete: false });
    const updateOnly = await request("/presences", {
      method: "POST",
      token: prefetToken,
      body: presencePayload,
    });
    assert.notEqual(updateOnly.status, 403, JSON.stringify(updateOnly.data));

    await patchAttendance({ canCreate: false, canRead: true, canUpdate: false, canDelete: false });
    const revokedWrite = await request("/presences", {
      method: "POST",
      token: prefetToken,
      body: presencePayload,
    });
    assert.equal(revokedWrite.status, 403, JSON.stringify(revokedWrite.data));
    assert.equal(revokedWrite.data?.code, "PERMISSION_DENIED");

    const parentToken = await login("+243 820 000 001", "1234", "CD-IN-26-001");
    const parentList = await request("/presences", { token: parentToken });
    assert.ok(
      [200, 403].includes(parentList.status),
      `GET /presences parent: ${parentList.status} ${JSON.stringify(parentList.data)}`,
    );
    if (parentList.status === 403) {
      assert.equal(parentList.data?.code, "PERMISSION_DENIED");
    }
    const parentChild = await request("/students/CD-IN-EL-26-001/presences", { token: parentToken });
    assert.ok(
      [200, 403].includes(parentChild.status),
      `GET fiche présences parent: ${parentChild.status} ${JSON.stringify(parentChild.data)}`,
    );
    const parentEffective = await request("/auth/effective-permissions", { token: parentToken });
    if (parentEffective.data?.permissions?.includes("Présences:READ")) {
      assert.equal(parentList.status, 200, JSON.stringify({ parentList: parentList.data, parentEffective: parentEffective.data }));
      assert.equal(parentChild.status, 200, JSON.stringify(parentChild.data));
    }

    const parentNotes = await request("/notes", { token: parentToken });
    assert.ok(
      [200, 403].includes(parentNotes.status),
      `GET /notes parent: ${parentNotes.status} ${JSON.stringify(parentNotes.data)}`,
    );
    if (parentEffective.data?.permissions?.includes("Notes:READ")) {
      assert.equal(parentNotes.status, 200, JSON.stringify({ parentNotes: parentNotes.data, parentEffective: parentEffective.data }));
    }
    if (parentNotes.status === 403) {
      assert.equal(parentNotes.data?.code, "PERMISSION_DENIED");
    }

    const prefetGet = await request("/presences", { token: prefetToken });
    assert.equal(prefetGet.status, 200, JSON.stringify(prefetGet.data));

    async function patchGrades(flags) {
      const current = await request(
        `/backoffice/rbac/permissions?roleKey=PREFET_ETUDES&countryCode=CD&schoolCode=${encodeURIComponent("CD-IN-26-001")}`,
        { token: superToken },
      );
      assert.equal(current.status, 200, JSON.stringify(current.data));
      const result = await request("/backoffice/rbac/permissions", {
        method: "PATCH",
        token: superToken,
        body: {
          roleKey: "PREFET_ETUDES",
          countryCode: "CD",
          schoolCode: "CD-IN-26-001",
          expectedUpdatedAt: current.data.updatedAt,
          grants: [{ moduleKey: "grades", ...flags }],
        },
      });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      return result.data.updatedAt;
    }

    const notePayload = {
      evaluationId: "EVAL-TEST",
      studentId: "CD-IN-EL-26-001",
      value: 12,
      scale: 20,
    };

    await patchGrades({ canCreate: false, canRead: true, canUpdate: false, canDelete: false });
    const notesDenied = await request("/notes", { method: "POST", token: prefetToken, body: notePayload });
    assert.equal(notesDenied.status, 403, JSON.stringify(notesDenied.data));
    assert.equal(notesDenied.data?.code, "PERMISSION_DENIED");
    const evalDenied = await request("/evaluations", {
      method: "POST",
      token: prefetToken,
      body: { title: "Interro RBAC", subject: "Mathématiques", className: "6ème A" },
    });
    assert.equal(evalDenied.status, 403, JSON.stringify(evalDenied.data));
    assert.equal(evalDenied.data?.code, "PERMISSION_DENIED");

    await patchGrades({ canCreate: true, canRead: true, canUpdate: false, canDelete: false });
    const notesGranted = await request("/notes", { method: "POST", token: prefetToken, body: notePayload });
    assert.notEqual(notesGranted.status, 403, JSON.stringify(notesGranted.data));
    assert.ok(
      [200, 201, 400, 404, 409].includes(notesGranted.status),
      `POST notes après grant: ${notesGranted.status} ${JSON.stringify(notesGranted.data)}`,
    );
    const evalGranted = await request("/evaluations", {
      method: "POST",
      token: prefetToken,
      body: { title: "Interro RBAC", subject: "Mathématiques", className: "6ème A" },
    });
    assert.notEqual(evalGranted.status, 403, JSON.stringify(evalGranted.data));

    await patchGrades({ canCreate: false, canRead: true, canUpdate: true, canDelete: false });
    const notesUpdateOnly = await request("/notes", { method: "POST", token: prefetToken, body: notePayload });
    assert.notEqual(notesUpdateOnly.status, 403, JSON.stringify(notesUpdateOnly.data));
    const evalPatchDeniedCreate = await request("/evaluations/EVAL-TEST", {
      method: "PATCH",
      token: prefetToken,
      body: { title: "Interro MAJ" },
    });
    assert.notEqual(evalPatchDeniedCreate.status, 403, JSON.stringify(evalPatchDeniedCreate.data));

    await patchGrades({ canCreate: false, canRead: true, canUpdate: false, canDelete: false });
    const notesRevoked = await request("/notes", { method: "POST", token: prefetToken, body: notePayload });
    assert.equal(notesRevoked.status, 403, JSON.stringify(notesRevoked.data));
    assert.equal(notesRevoked.data?.code, "PERMISSION_DENIED");

    const prefetNotesGet = await request("/notes", { token: prefetToken });
    assert.equal(prefetNotesGet.status, 200, JSON.stringify(prefetNotesGet.data));

    const stale = await request("/backoffice/rbac/permissions", {
      method: "PATCH",
      token: superToken,
      body: {
        roleKey: "PREFET_ETUDES",
        schoolCode: "CD-IN-26-001",
        expectedUpdatedAt: configured.data.updatedAt,
        grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
      },
    });
    assert.equal(stale.status, 409, JSON.stringify(stale.data));

    const createdRole = await request("/backoffice/rbac/roles", {
      method: "POST",
      token: superToken,
      body: { roleName: "Auditeur RBAC", roleCode: "RBAC_AUDITOR", permissions: ["Documents:READ"] },
    });
    assert.equal(createdRole.status, 201, JSON.stringify(createdRole.data));
    const archived = await request(`/backoffice/rbac/roles/${encodeURIComponent(createdRole.data.id)}/archive`, {
      method: "POST",
      token: superToken,
    });
    assert.equal(archived.status, 200, JSON.stringify(archived.data));
    const grantArchived = await request("/backoffice/users/USER-SECRETARY-0001/roles/grant", {
      method: "POST",
      token: superToken,
      body: { role: "Auditeur RBAC" },
    });
    assert.ok([409, 404].includes(grantArchived.status), JSON.stringify(grantArchived.data));

    const superProtect = catalog.data.roles.find((row) => row.roleCode === "SUPER_ADMIN");
    if (superProtect) {
      const archiveSuper = await request(`/backoffice/rbac/roles/${encodeURIComponent(superProtect.id)}/archive`, {
        method: "POST",
        token: superToken,
      });
      assert.equal(archiveSuper.status, 403, JSON.stringify(archiveSuper.data));
    }

    const mandatoryUsers = await request("/backoffice/rbac/permissions", {
      method: "PATCH",
      token: superToken,
      body: {
        roleKey: "SUPER_ADMIN",
        countryCode: "CD",
        schoolCode: "CD-IN-26-001",
        grants: [{ moduleKey: "users", canCreate: true, canRead: false, canUpdate: true, canDelete: true }],
      },
    });
    assert.equal(mandatoryUsers.status, 409, JSON.stringify(mandatoryUsers.data));
    assert.equal(mandatoryUsers.data?.code, "MANDATORY_PERMISSION");

    const currentAttendance = await request(
      `/backoffice/rbac/permissions?roleKey=PREFET_ETUDES&countryCode=CD&schoolCode=${encodeURIComponent("CD-IN-26-001")}`,
      { token: superToken },
    );
    const dependencyDenied = await request("/backoffice/rbac/permissions", {
      method: "PATCH",
      token: superToken,
      body: {
        roleKey: "PREFET_ETUDES",
        countryCode: "CD",
        schoolCode: "CD-IN-26-001",
        expectedUpdatedAt: currentAttendance.data?.updatedAt,
        grants: [{ moduleKey: "attendance", canCreate: true, canRead: false, canUpdate: false, canDelete: false }],
      },
    });
    assert.equal(dependencyDenied.status, 409, JSON.stringify(dependencyDenied.data));
    assert.equal(dependencyDenied.data?.code, "MANDATORY_PERMISSION");

    console.log("verify-functional-rbac.js OK");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
