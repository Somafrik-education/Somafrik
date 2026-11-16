/**
 * S1.4 — Tests RBAC : BackOffice State supprimé (410) + routes MVP.
 * RBAC-HTTP-MAINT-01 : GET/PUT /api/backoffice/state sont supprimés (LOT 8) ; la partie
 * HTTP vérifie désormais leurs refus 410 pour chaque rôle et l'isolation via les API métier.
 *
 * Usage:
 *   node backend/scripts/verify-rbac-s1-4.js
 *   SOMAFRIK_API_URL=http://127.0.0.1:5055/api node backend/scripts/verify-rbac-s1-4.js
 */
const { superadminLoginPassword } = require("../lib/superadminSeedSecret");
const assert = require("assert");
const path = require("path");

const {
  SECRETARY_WRITABLE_ENTITIES,
  ACCOUNTANT_WRITABLE_ENTITIES,
  ADMIN_SCHOOL_WRITABLE_ENTITIES,
  PREFET_WRITABLE_ENTITIES,
  DIRECTOR_WRITABLE_ENTITIES,
  COUNTRY_ADMIN_WRITABLE_ENTITIES,
  evaluateBackOfficeWriteAccess,
  getWritableBackOfficeEntitiesForPrincipal,
  getEditableEntitiesForPrincipalRole,
} = require("../lib/backOfficeWritableEntities");
const {
  canAccessMvpRoutes,
  scopeMvpDatasetForPrincipal,
} = require("../lib/mvpAccess");
const { TenantScopeService } = require("../services/tenantScopeService");
const {
  assertBackOfficeStateWriteRemoved,
  assertBackOfficeStateReadRemoved,
} = require("../lib/backofficeStatePutExpectation");
const { probeLiveApi } = require("./liveApiProbe");

function runMatrixUnitTests() {
  const admin = { role: "Admin School", schoolCode: "CD-2026-0001" };
  const secretary = { role: "Secrétaire", schoolCode: "CD-2026-0001" };
  const accountant = { role: "Comptable", schoolCode: "CD-2026-0001" };
  const allEntities = ["students", "users", "notes", "payments", "auditLog"];

  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("users"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("contacts"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("relations"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("messages"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("announcements"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("notes"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("presences"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("courses"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("evaluations"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("students"));
  assert.ok(!SECRETARY_WRITABLE_ENTITIES.includes("students"));
  assert.ok(!PREFET_WRITABLE_ENTITIES.includes("students"));
  assert.ok(!SECRETARY_WRITABLE_ENTITIES.includes("payments"));
  assert.ok(!SECRETARY_WRITABLE_ENTITIES.includes("notes"));
  assert.ok(!SECRETARY_WRITABLE_ENTITIES.includes("users"));
  assert.ok(!SECRETARY_WRITABLE_ENTITIES.includes("feeGrids"));

  // Fail-closed : principal absent
  assert.deepStrictEqual(getWritableBackOfficeEntitiesForPrincipal(null, allEntities), []);
  assert.deepStrictEqual(getWritableBackOfficeEntitiesForPrincipal(undefined, allEntities), []);
  assert.deepStrictEqual(getEditableEntitiesForPrincipalRole(null, allEntities), []);
  assert.deepStrictEqual(getEditableEntitiesForPrincipalRole(undefined, allEntities), []);
  assert.strictEqual(evaluateBackOfficeWriteAccess(null, []).ok, false);
  assert.strictEqual(evaluateBackOfficeWriteAccess(null, ["students"]).ok, false);
  assert.strictEqual(evaluateBackOfficeWriteAccess(undefined, ["payments"]).ok, false);

  // auditLog jamais writable côté client
  for (const list of [
    ADMIN_SCHOOL_WRITABLE_ENTITIES,
    SECRETARY_WRITABLE_ENTITIES,
    ACCOUNTANT_WRITABLE_ENTITIES,
    PREFET_WRITABLE_ENTITIES,
    DIRECTOR_WRITABLE_ENTITIES,
    COUNTRY_ADMIN_WRITABLE_ENTITIES,
  ]) {
    assert.ok(!list.includes("auditLog"), "auditLog ne doit pas être writable client");
  }
  assert.ok(!getWritableBackOfficeEntitiesForPrincipal(admin).includes("auditLog"));
  assert.ok(!getWritableBackOfficeEntitiesForPrincipal(secretary).includes("auditLog"));
  assert.ok(!getWritableBackOfficeEntitiesForPrincipal(accountant).includes("auditLog"));
  assert.ok(
    !getWritableBackOfficeEntitiesForPrincipal(
      { role: "Super Administrateur Somafrik" },
      allEntities,
    ).includes("auditLog"),
  );
  assert.strictEqual(evaluateBackOfficeWriteAccess(admin, ["auditLog"]).ok, false);
  assert.strictEqual(evaluateBackOfficeWriteAccess(secretary, ["auditLog"]).ok, false);
  assert.strictEqual(evaluateBackOfficeWriteAccess(accountant, ["auditLog"]).ok, false);

  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(secretary, ["students", "payments"]).ok,
    false,
  );
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(secretary, ["payments"]).ok,
    false,
  );
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(secretary, ["notes"]).ok,
    false,
  );
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(accountant, ["payments", "studentFees"]).ok,
    false,
  );
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(accountant, ["users"]).ok,
    false,
  );
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(accountant, ["notes"]).ok,
    false,
  );
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(admin, ["users", "notes", "feeGrids"]).ok,
    false,
  );

  // Pas d'élargissement Secrétaire / Comptable vs Admin School
  for (const entity of SECRETARY_WRITABLE_ENTITIES) {
    assert.ok(
      ADMIN_SCHOOL_WRITABLE_ENTITIES.includes(entity),
      `Secrétaire entity ${entity} must be subset of Admin School`,
    );
  }
  for (const entity of ACCOUNTANT_WRITABLE_ENTITIES) {
    assert.ok(
      ADMIN_SCHOOL_WRITABLE_ENTITIES.includes(entity),
      `Comptable entity ${entity} must be subset of Admin School`,
    );
  }

  assert.strictEqual(canAccessMvpRoutes(admin), true);
  assert.strictEqual(canAccessMvpRoutes(secretary), true);
  assert.strictEqual(canAccessMvpRoutes({ role: "Enseignant" }), true);
  assert.strictEqual(canAccessMvpRoutes({ role: "Parent" }), false);
  assert.strictEqual(canAccessMvpRoutes({ role: "Élève / Étudiant" }), false);
  assert.strictEqual(canAccessMvpRoutes(null), false);

  const tenantScopeService = new TenantScopeService();
  const sampleDataset = {
    school: { code: "CD-2026-0001", name: "A" },
    platformSchools: [
      { code: "CD-2026-0001", name: "A", countryCode: "CD" },
      { code: "BI-2026-0001", name: "B", countryCode: "BI" },
    ],
    students: [
      { id: "1", schoolCode: "CD-2026-0001", name: "Local" },
      { id: "2", schoolCode: "BI-2026-0001", name: "Other" },
    ],
    classes: [
      { id: "c1", schoolCode: "CD-2026-0001", name: "6A" },
      { id: "c2", schoolCode: "BI-2026-0001", name: "6B" },
    ],
    courses: [],
    notes: [],
    payments: [
      { id: "p1", schoolCode: "CD-2026-0001", amount: 10 },
      { id: "p2", schoolCode: "BI-2026-0001", amount: 99 },
    ],
  };

  // Fail-closed MVP : principal absent ⇒ exception (jamais dataset global)
  assert.throws(
    () => scopeMvpDatasetForPrincipal(sampleDataset, null, tenantScopeService),
    (error) => error?.code === "MVP_SCOPE_PRINCIPAL_REQUIRED",
  );
  assert.throws(
    () => scopeMvpDatasetForPrincipal(sampleDataset, undefined, tenantScopeService),
    (error) => error?.code === "MVP_SCOPE_PRINCIPAL_REQUIRED",
  );

  const scoped = scopeMvpDatasetForPrincipal(sampleDataset, admin, tenantScopeService);
  assert.strictEqual(scoped.students.length, 1);
  assert.strictEqual(scoped.students[0].id, "1");
  assert.strictEqual(scoped.payments.length, 1);
  assert.strictEqual(scoped.school.code, "CD-2026-0001");

  console.log("OK unit: matrice RBAC + scope MVP + fail-closed");
}

async function runHttpTestsIfAvailable() {
  const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";
  if (!(await probeLiveApi(base, "verify-rbac-s1-4"))) return;

  const { request, loginFull, extractApiList } = require(path.join(__dirname, "..", "..", "scripts", "e2e-api-helpers.js"));
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
  const secretary = await login("secretaire", "1234", "CD-2026-0001");
  const superadmin = await login("superadmin@somafrik.app", superadminLoginPassword());

  // Mobile teacher / parent for MVP RBAC
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

  const parentMobileRes = await request("/login", {
    method: "POST",
    body: {
      role: "parent_student",
      schoolCode: "CD-2026-0001",
      identifier: "+243 820 000 001",
      password: "1234",
    },
  });
  assert.strictEqual(parentMobileRes.status, 200, "parent mobile login");
  let parentToken = parentMobileRes.data.accessToken;
  if (parentMobileRes.data.user?.mustChangePassword) {
    const changeParent = await request("/auth/change-password", {
      method: "POST",
      token: parentToken,
      body: { newPassword: STRONG_PASSWORD },
    });
    assert.strictEqual(changeParent.status, 200, "parent change-password");
    parentToken = changeParent.data.accessToken;
  }

  // Lecture globale supprimée (LOT 8) : 410 pour tous les rôles, plateforme comprise.
  for (const [label, token] of [
    ["Admin School", schoolAdmin.accessToken],
    ["Secrétaire", secretary.accessToken],
    ["Super Admin", superadmin.accessToken],
  ]) {
    assertBackOfficeStateReadRemoved(await request("/backoffice/state", { token }), `GET state ${label}`);
  }

  // Provision Comptable via les API Comptes utilisateurs (domaine autorisé à Admin School).
  const comptableUser = {
    firstName: "Compte",
    lastName: "Able",
    role: "Comptable",
    // Adresse unique par exécution : le script reste rejouable sur la même base.
    email: `comptable-s14-${Date.now().toString(36)}@somafrik.app`,
    status: "Actif",
    temporaryPassword: "Soma1234",
  };
  const createComptable = await request("/backoffice/users", {
    method: "POST",
    token: schoolAdmin.accessToken,
    body: {
      firstName: comptableUser.firstName,
      lastName: comptableUser.lastName,
      email: comptableUser.email,
      status: comptableUser.status,
      temporaryPassword: comptableUser.temporaryPassword,
    },
  });
  assert.strictEqual(createComptable.status, 201, `create comptable: ${createComptable.status}`);
  const grantComptable = await request(`/backoffice/users/${createComptable.data.id}/roles/grant`, {
    method: "POST",
    token: schoolAdmin.accessToken,
    body: { role: comptableUser.role },
  });
  assert.strictEqual(grantComptable.status, 200, `grant comptable: ${JSON.stringify(grantComptable.data)}`);

  const accountant = await login(comptableUser.email, "Soma1234", "CD-2026-0001");

  // A1–A5 — Écriture globale supprimée : 410 quel que soit le rôle ou le domaine visé
  // (élèves, notes, paiements, utilisateurs, auditLog client).
  const foreignStudent = {
    id: "ELE-FOREIGN-S14",
    publicId: "ELE-FOREIGN-S14",
    name: "Foreign",
    schoolCode: "BI-2026-0001",
    className: "6ème A",
  };
  const legacyWrites = [
    ["students", { students: [{ id: "1", schoolCode: "CD-2026-0001" }] }],
    ["notes", { notes: [{ id: "NOTE-FORBIDDEN", studentId: "1", value: 10, schoolCode: "CD-2026-0001" }] }],
    ["payments", { payments: [{ id: "PAY-FORBIDDEN", studentId: "1", amount: 1 }] }],
    ["users", { users: [{ id: "USR-FORBIDDEN", role: "Admin School" }] }],
    ["auditLog", { auditLog: [{ id: "AUD-CLIENT-FORBIDDEN", action: "tamper" }] }],
    ["students cross-tenant", { students: [foreignStudent] }],
  ];
  for (const [label, token] of [
    ["Admin School", schoolAdmin.accessToken],
    ["Secrétaire", secretary.accessToken],
    ["Comptable", accountant.accessToken],
    ["Super Admin", superadmin.accessToken],
  ]) {
    for (const [domain, body] of legacyWrites) {
      assertBackOfficeStateWriteRemoved(
        await request("/backoffice/state", { method: "PUT", token, body }),
        `PUT state ${label} ${domain}`,
      );
    }
  }

  // A6 — Cross-tenant : la liste métier de la secrétaire reste limitée à son établissement
  // et ne contient jamais l'élève étranger proposé par l'écriture refusée.
  const scopedStudents = await request("/students", { token: secretary.accessToken });
  assert.strictEqual(scopedStudents.status, 200, `GET /students secrétaire: ${scopedStudents.status}`);
  const scopedRows = extractApiList({ body: scopedStudents.data });
  assert.ok(scopedRows.length > 0, "la secrétaire voit les élèves de son établissement");
  assert.strictEqual(
    scopedRows.some((row) => row.id === foreignStudent.id || row.publicId === foreignStudent.publicId),
    false,
    "élève cross-tenant jamais persisté ni visible",
  );
  // Même établissement sous ses deux identifiants (code établissement / code de connexion).
  const ownSchoolCodes = new Set(["CD-2026-0001", "CD-UK-26-001"]);
  for (const row of scopedRows) {
    const code = String(row.schoolCode ?? row.school_code ?? "").toUpperCase();
    if (code) assert.ok(ownSchoolCodes.has(code), `élève hors établissement visible: ${code}`);
  }

  // B — MVP
  for (const route of ["/mvp/readiness", "/mvp/snapshot", "/mvp/dashboard"]) {
    const allowed = await request(route, { token: schoolAdmin.accessToken });
    assert.strictEqual(allowed.status, 200, `${route} school admin`);

    const teacherAllowed = await request(route, { token: teacherToken });
    assert.strictEqual(teacherAllowed.status, 200, `${route} teacher`);

    const parentDenied = await request(route, { token: parentToken });
    assert.strictEqual(parentDenied.status, 403, `${route} parent 403`);

    const anon = await request(route);
    assert.strictEqual(anon.status, 401, `${route} anon 401`);
  }

  const dash = await request("/mvp/dashboard", { token: schoolAdmin.accessToken });
  assert.strictEqual(dash.data.schoolCode, "CD-2026-0001");

  const snap = await request("/mvp/snapshot", { token: schoolAdmin.accessToken });
  const latePayers = snap.data.latePayers ?? [];
  for (const row of latePayers) {
    if (row.schoolCode) {
      assert.strictEqual(
        String(row.schoolCode).toUpperCase(),
        "CD-2026-0001",
        "latePayer hors tenant",
      );
    }
  }

  console.log("OK http: BackOffice State 410 (lecture/écriture, tous rôles) + MVP + cross-tenant");
}

async function main() {
  runMatrixUnitTests();
  await runHttpTestsIfAvailable();
  console.log("verify-rbac-s1-4: SUCCESS");
}

main().catch((error) => {
  console.error("verify-rbac-s1-4: FAIL");
  console.error(error);
  process.exit(1);
});

