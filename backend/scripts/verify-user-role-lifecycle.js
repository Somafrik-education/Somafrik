"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

const ROOT = path.resolve(__dirname, "../..");
const PORT = 19741;
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
  let session = result.data;
  if (session?.user?.mustChangePassword && String(password).length >= 8) {
    const changed = await request("/auth/change-password", {
      method: "POST",
      token,
      body: { newPassword: password },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    token = changed.data.accessToken || changed.data.token || token;
    session = { ...session, ...changed.data, accessToken: token };
  }
  return { token, user: session.user, accessToken: token };
}

function assertStaticGuards() {
  const teachersPage = fs.readFileSync(path.join(ROOT, "web/src/pages/etablissement/TeachersListPage.tsx"), "utf8");
  assert.equal(/Ajouter un enseignant|Créer l'enseignant/.test(teachersPage), false, "Web Enseignants sans bouton Créer");
  const teachersTest = fs.readFileSync(path.join(ROOT, "web/src/pages/etablissement/TeachersListPage.test.tsx"), "utf8");
  assert.match(teachersTest, /Ajouter un enseignant/);
  const mobileHint = fs.readFileSync(path.join(ROOT, "Mobile/src/lib/contactProvisioning.ts"), "utf8");
  assert.match(mobileHint, /entityCreateViaContactsOnly/);
  assert.match(mobileHint, /teachers/);
  const mobileCrud = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/AdminCrudScreen.tsx"), "utf8");
  assert.match(mobileCrud, /entityCreateViaContactsOnly\(entity\)/);
  const server = fs.readFileSync(path.join(ROOT, "backend/server.js"), "utf8");
  assert.match(server, /TEACHER_IDENTITY_MUST_COME_FROM_USERS/);
  assert.match(server, /roles\/grant/);
  assert.match(server, /roles\/revoke/);
}

async function main() {
  assertStaticGuards();

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
    const school = await login("admin", "1234", "CD-2026-0001");
    const schoolBi = await login("admin", "1234", "BI-2026-0002");
    const superadmin = await login("superadmin", "1234");
    const teacherSeed = await login("ENS-0001", "1234", "CD-2026-0001");

    const legacy = await request("/backoffice/state", {
      method: "PUT",
      token: school.token,
      body: { users: [{ id: "forged", role: "Admin School" }] },
    });
    assertBackOfficeStateWriteRemoved(legacy);

    const created = await request("/backoffice/users", {
      method: "POST",
      token: school.token,
      body: { firstName: "Marie", lastName: "Kabeya", email: "marie.lifecycle@test.local", phone: "+243900222111" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.match(String(created.data.id), /^[0-9a-f-]{36}$/i);
    assert.match(String(created.data.publicId), /^USR-\d{4}-\d{5}$/);
    assert.equal(created.data.assignmentStatus, "Sans affectation");
    assert.deepEqual(created.data.roleKeys ?? [], []);

    for (const body of [
      { firstName: "X", lastName: "Y", id: "client-id" },
      { firstName: "X", lastName: "Y", user_code: "USR-1999-00001" },
      { firstName: "X", lastName: "Y", role: "Secrétaire" },
      { firstName: "X", lastName: "Y", roles: ["Secrétaire"] },
    ]) {
      const rejected = await request("/backoffice/users", { method: "POST", token: school.token, body });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
    }

    const assignable = await request("/backoffice/users/assignable-roles", { token: school.token });
    assert.equal(assignable.status, 200, JSON.stringify(assignable.data));
    const names = (assignable.data.roles ?? []).map((row) => row.roleName);
    assert.equal(names.includes("Parent"), false);
    assert.equal(names.includes("Élève / Étudiant"), false);
    assert.equal(names.includes("Super Administrateur Somafrik"), false);

    const grantPrefet = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
      method: "POST",
      token: school.token,
      body: { role: "Préfet des études" },
    });
    assert.equal(grantPrefet.status, 200, JSON.stringify(grantPrefet.data));
    const grantTeacher = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
      method: "POST",
      token: school.token,
      body: { role: "Enseignant" },
    });
    assert.equal(grantTeacher.status, 200, JSON.stringify(grantTeacher.data));
    assert.deepEqual(grantTeacher.data.roleKeys, ["PREFET_ETUDES", "TEACHER"]);
    assert.equal(grantTeacher.data.roles[0], "Préfet des études");

    const teachers = await request("/teachers", { token: school.token });
    assert.equal(teachers.status, 200);
    assert.ok((teachers.data ?? []).some((row) => String(row.userId) === String(created.data.id)));

    const blockedTeacherCreate = await request("/teachers", {
      method: "POST",
      token: school.token,
      body: { firstName: "X", lastName: "Y", phone: "+243811000999", temporaryPassword: "TempPass1" },
    });
    assert.equal(blockedTeacherCreate.status, 403);
    assert.equal(blockedTeacherCreate.data.code, "TEACHER_IDENTITY_MUST_COME_FROM_USERS");

    for (const role of ["Parent", "STUDENT", "Super Administrateur Somafrik", "InconnuXYZ"]) {
      const denied = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
        method: "POST",
        token: school.token,
        body: { role },
      });
      assert.ok(denied.status === 403 || denied.status === 400, `${role} ${JSON.stringify(denied.data)}`);
    }

    const replace = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
      method: "POST",
      token: school.token,
      body: { roles: ["Secrétaire", "Comptable"] },
    });
    assert.equal(replace.status, 400, JSON.stringify(replace.data));

    const foreign = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
      method: "POST",
      token: schoolBi.token,
      body: { role: "Secrétaire" },
    });
    assert.equal(foreign.status, 403, JSON.stringify(foreign.data));

    const selfGrant = await request(`/backoffice/users/${school.user.id}/roles/grant`, {
      method: "POST",
      token: school.token,
      body: { role: "Comptable" },
    });
    assert.notEqual(selfGrant.status, 200, JSON.stringify(selfGrant.data));
    assert.ok(
      selfGrant.status === 403 || selfGrant.status === 404,
      `auto-attribution refusée, reçu ${selfGrant.status} ${JSON.stringify(selfGrant.data)}`,
    );

    const teacherGrant = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
      method: "POST",
      token: teacherSeed.token,
      body: { role: "Secrétaire" },
    });
    assert.equal(teacherGrant.status, 403, JSON.stringify(teacherGrant.data));

    const missing = await request("/backoffice/users/00000000-0000-0000-0000-000000000099/roles/grant", {
      method: "POST",
      token: school.token,
      body: { role: "Secrétaire" },
    });
    assert.equal(missing.status, 404, JSON.stringify(missing.data));

    const [raceA, raceB] = await Promise.all([
      request(`/backoffice/users/${created.data.id}/roles/grant`, {
        method: "POST",
        token: school.token,
        body: { role: "Comptable" },
      }),
      request(`/backoffice/users/${created.data.id}/roles/grant`, {
        method: "POST",
        token: school.token,
        body: { role: "Comptable" },
      }),
    ]);
    const raceStatuses = [raceA.status, raceB.status].sort();
    assert.deepEqual(raceStatuses, [200, 409]);

    const revokePrefet = await request(`/backoffice/users/${created.data.id}/roles/revoke`, {
      method: "POST",
      token: school.token,
      body: { role: "Préfet des études" },
    });
    assert.equal(revokePrefet.status, 200, JSON.stringify(revokePrefet.data));
    assert.ok(revokePrefet.data.roleKeys.includes("TEACHER"));

    const revokeTeacher = await request(`/backoffice/users/${created.data.id}/roles/revoke`, {
      method: "POST",
      token: school.token,
      body: { role: "Enseignant" },
    });
    assert.equal(revokeTeacher.status, 200, JSON.stringify(revokeTeacher.data));
    const revokeLast = await request(`/backoffice/users/${created.data.id}/roles/revoke`, {
      method: "POST",
      token: school.token,
      body: { role: "Comptable" },
    });
    assert.equal(revokeLast.status, 200, JSON.stringify(revokeLast.data));
    assert.equal(revokeLast.data.assignmentStatus, "Sans affectation");
    assert.deepEqual(revokeLast.data.roleKeys ?? [], []);

    const listed = await request("/backoffice/users", { token: school.token });
    const afterRevoke = (listed.data ?? []).find((row) => row.id === created.data.id);
    assert.ok(afterRevoke, "identité conservée après révocation du dernier rôle");
    assert.equal(afterRevoke.assignmentStatus, "Sans affectation");

    const regrant = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
      method: "POST",
      token: school.token,
      body: { role: "Enseignant" },
    });
    assert.equal(regrant.status, 200, JSON.stringify(regrant.data));
    const teachersAfter = await request("/teachers", { token: school.token });
    assert.equal(
      (teachersAfter.data ?? []).filter((row) => String(row.userId) === String(created.data.id)).length,
      1,
      "réattribution enseignant sans duplication",
    );

    const contact = await request("/backoffice/contacts", {
      method: "POST",
      token: school.token,
      body: {
        firstName: "Marie",
        lastName: "Kabeya",
        contactType: "Parent",
        phone: "+243900222111",
        email: "marie.lifecycle@test.local",
      },
    });
    assert.equal(contact.status, 201, JSON.stringify(contact.data));
    const provisioned = await request(`/backoffice/contacts/${contact.data.id}/provision-account`, {
      method: "POST",
      token: school.token,
      body: { role: "Parent", studentId: "1" },
    });
    assert.ok(provisioned.status === 200 || provisioned.status === 201, JSON.stringify(provisioned.data));
    assert.equal(provisioned.data.user.id, created.data.id, "enseignant-parent = un seul utilisateur");

    const usersAfter = await request("/backoffice/users", { token: school.token });
    assert.equal(
      (usersAfter.data ?? []).filter((row) => row.email === "marie.lifecycle@test.local").length,
      1,
    );

    const [createA, createB] = await Promise.all([
      request("/backoffice/users", {
        method: "POST",
        token: school.token,
        body: { firstName: "A", lastName: "Un", email: "a.lifecycle@test.local" },
      }),
      request("/backoffice/users", {
        method: "POST",
        token: school.token,
        body: { firstName: "B", lastName: "Deux", email: "b.lifecycle@test.local" },
      }),
    ]);
    assert.equal(createA.status, 201, JSON.stringify(createA.data));
    assert.equal(createB.status, 201, JSON.stringify(createB.data));
    assert.notEqual(createA.data.id, createB.data.id);
    assert.notEqual(createA.data.publicId, createB.data.publicId);

    const platformGrant = await request(`/backoffice/users/${created.data.id}/roles/grant`, {
      method: "POST",
      token: superadmin.token,
      body: { role: "Super Administrateur Somafrik" },
    });
    assert.equal(platformGrant.status, 403, JSON.stringify(platformGrant.data));

    console.log("verify-user-role-lifecycle.js OK");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
