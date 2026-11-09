/**
 * HOTFIX-RBAC-ADMIN-01 — Création enseignants sans auditLog client.
 * Classes : plus d'écriture via /api/backoffice/state (clôture /api/classes).
 * RBAC-HTTP-MAINT-01 : enseignants et affectations ne s'écrivent plus via l'état BackOffice
 * (a26008ed) et GET/PUT /api/backoffice/state sont supprimés (410, LOT 8). L'identité
 * enseignant part de Comptes utilisateurs ; POST /api/teachers reste refusé.
 *
 * Usage:
 *   node backend/scripts/verify-rbac-admin-01.js
 *   SOMAFRIK_API_URL=http://127.0.0.1:5000/api node backend/scripts/verify-rbac-admin-01.js
 */
const { superadminLoginPassword } = require("../lib/superadminSeedSecret");
const assert = require("assert");
const path = require("path");
const {
  assertBackOfficeStateWriteRemoved,
  assertBackOfficeStateReadRemoved,
} = require("../lib/backofficeStatePutExpectation");
const { probeLiveApi } = require("./liveApiProbe");

const {
  ADMIN_SCHOOL_WRITABLE_ENTITIES,
  evaluateBackOfficeWriteAccess,
  getWritableBackOfficeEntitiesForPrincipal,
} = require("../lib/backOfficeWritableEntities");
const {
  evaluateTeacherNotesTouchedKeys,
  isTeacherNotesPrincipal,
} = require("../lib/teacherNotesWriteAccess");

function runUnitTests() {
  const schoolAdmin = { role: "Admin School", schoolCode: "CD-2026-0001" };
  const teacher = { role: "Enseignant", schoolCode: "CD-2026-0001", authSource: "backoffice" };
  const superadmin = { role: "Super Administrateur Somafrik", schoolCode: "*" };

  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("classes"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("teachers"), "teachers fermé (a26008ed)");
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("auditLog"));
  assert.ok(ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("exams"));

  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["classes"]).ok,
    false,
    "Admin School + classes → refusé (legacy fermé)",
  );
  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["teachers"]).ok,
    false,
    "Admin School + teachers → refusé (identité via Comptes utilisateurs)",
  );
  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["exams"]).ok,
    true,
    "Admin School + exams (entité encore listée)",
  );
  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["exams", "auditLog"]).ok,
    false,
    "Admin School + auditLog client → refusé",
  );
  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["auditLog"]).ok,
    false,
    "Admin School auditLog seul → refusé",
  );

  assert.ok(isTeacherNotesPrincipal(teacher));
  assert.strictEqual(
    evaluateTeacherNotesTouchedKeys(["classes"]).ok,
    false,
    "Enseignant + classes → refusé",
  );
  assert.strictEqual(
    evaluateTeacherNotesTouchedKeys(["teachers"]).ok,
    false,
    "Enseignant + teachers → refusé",
  );
  assert.strictEqual(
    evaluateTeacherNotesTouchedKeys(["evaluations", "notes"]).ok,
    true,
    "Enseignant + notes OK",
  );

  const superWritable = getWritableBackOfficeEntitiesForPrincipal(superadmin, [
    "classes",
    "teachers",
    "auditLog",
  ]);
  // Matrice théorique seulement : toute écriture d'état est de toute façon refusée (410, HTTP ci-dessous).
  assert.ok(!superWritable.includes("teachers"), "teachers fermé aussi pour le Super Admin");
  assert.ok(!superWritable.includes("auditLog"), "Superadmin ne peut pas écrire auditLog client");

  console.log("OK unit: HOTFIX-RBAC-ADMIN-01 matrice teachers/auditLog fermés (+ classes legacy fermé)");
}

async function runHttpTestsIfAvailable() {
  const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";
  if (!(await probeLiveApi(base, "verify-rbac-admin-01"))) return;

  const { request, loginFull } = require(path.join(__dirname, "..", "..", "scripts", "e2e-api-helpers.js"));
  const STRONG_PASSWORD = "SomaTest1";

  async function login(identifier, password, schoolCode) {
    const session = await loginFull(identifier, password, schoolCode);
    if (session?.user?.mustChangePassword && session.accessToken) {
      const changeRes = await request("/auth/change-password", {
        method: "POST",
        token: session.accessToken,
        body: { newPassword: STRONG_PASSWORD },
      });
      assert.strictEqual(changeRes.status, 200, `change-password ${identifier}`);
      return {
        ...session,
        ...changeRes.data,
        accessToken: changeRes.data.accessToken,
        user: { ...(session.user ?? {}), ...(changeRes.data.user ?? {}), mustChangePassword: false },
      };
    }
    return session;
  }

  const schoolAdmin = await login("admin", "1234", "CD-2026-0001");
  const superadmin = await login("superadmin@somafrik.app", superadminLoginPassword());
  assert.ok(schoolAdmin?.accessToken, "Admin School login");
  assert.ok(superadmin?.accessToken, "Superadmin login");

  const teacherMobileRes = await request("/login", {
    method: "POST",
    body: { role: "teacher", schoolCode: "CD-2026-0001", identifier: "ENS-0001", pin: "1234" },
  });
  assert.strictEqual(teacherMobileRes.status, 200, "teacher mobile login");
  let teacherToken = teacherMobileRes.data.accessToken;
  if (teacherMobileRes.data.user?.mustChangePassword) {
    const changeTeacher = await request("/auth/change-password", {
      method: "POST",
      token: teacherToken,
      body: { newPassword: STRONG_PASSWORD },
    });
    assert.strictEqual(changeTeacher.status, 200, "teacher change-password");
    teacherToken = changeTeacher.data.accessToken;
  }

  assertBackOfficeStateReadRemoved(
    await request("/backoffice/state", { token: schoolAdmin.accessToken }),
    "GET state Admin School",
  );
  const stamp = Date.now().toString(36);
  const schoolCode = "CD-2026-0001";
  const classRow = { id: `CLS-RBAC-ADMIN-01-${stamp}`, name: `2ème A ${stamp}`, schoolCode, level: "2ème", capacity: 40 };
  const teacherRow = {
    id: `TCH-RBAC-ADMIN-01-${stamp}`,
    publicId: `ENS-RBAC-${stamp}`,
    name: "Test",
    firstName: "RBAC",
    schoolCode,
    status: "Actif",
  };

  // A1–A5 — Classes, enseignants et auditLog client via l'état BackOffice : 410 pour
  // l'Admin School, l'enseignant et le Super Admin (plus aucune écriture partielle).
  for (const [label, token] of [
    ["Admin School", schoolAdmin.accessToken],
    ["Enseignant", teacherToken],
    ["Super Admin", superadmin.accessToken],
  ]) {
    for (const [domain, body] of [
      ["classes", { classes: [classRow] }],
      ["teachers", { teachers: [teacherRow] }],
      ["teachers + auditLog", { teachers: [teacherRow], auditLog: [{ id: "AUD-TAMPER", action: "teachers.create" }] }],
    ]) {
      assertBackOfficeStateWriteRemoved(
        await request("/backoffice/state", { method: "PUT", token, body }),
        `PUT state ${label} ${domain}`,
      );
    }
  }

  // A6 — Création d'enseignant par le module Enseignants : refusée pour l'Admin School
  // (identité via Comptes utilisateurs) et refusée par le RBAC pour un enseignant.
  const adminCreate = await request("/teachers", {
    method: "POST",
    token: schoolAdmin.accessToken,
    body: { firstName: "RBAC", lastName: stamp },
  });
  assert.strictEqual(adminCreate.status, 403, `Admin POST /teachers: ${adminCreate.status}`);
  assert.strictEqual(adminCreate.data?.code, "TEACHER_IDENTITY_MUST_COME_FROM_USERS");
  const teacherCreate = await request("/teachers", {
    method: "POST",
    token: teacherToken,
    body: { firstName: "RBAC", lastName: stamp },
  });
  assert.strictEqual(teacherCreate.status, 403, `Enseignant POST /teachers: ${teacherCreate.status}`);
  assert.notStrictEqual(teacherCreate.data?.code, "TEACHER_IDENTITY_MUST_COME_FROM_USERS", "refus RBAC en amont");

  console.log("OK http: HOTFIX-RBAC-ADMIN-01 état BackOffice 410 + création enseignant refusée hors Comptes utilisateurs");
}

async function main() {
  runUnitTests();
  await runHttpTestsIfAvailable();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
