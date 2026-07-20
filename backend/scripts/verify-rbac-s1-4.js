/**
 * S1.4 — Tests RBAC : PUT /api/backoffice/state + routes MVP.
 *
 * Usage:
 *   node backend/scripts/verify-rbac-s1-4.js
 *   SOMAFRIK_API_URL=http://127.0.0.1:5055/api node backend/scripts/verify-rbac-s1-4.js
 */
const assert = require("assert");
const path = require("path");

const {
  SECRETARY_WRITABLE_ENTITIES,
  ACCOUNTANT_WRITABLE_ENTITIES,
  ADMIN_SCHOOL_WRITABLE_ENTITIES,
  evaluateBackOfficeWriteAccess,
} = require("../lib/backOfficeWritableEntities");
const {
  canAccessMvpRoutes,
  scopeMvpDatasetForPrincipal,
} = require("../lib/mvpAccess");
const { TenantScopeService } = require("../services/tenantScopeService");

function runMatrixUnitTests() {
  const admin = { role: "Admin School", schoolCode: "CD-2026-0001" };
  const secretary = { role: "Secrétaire", schoolCode: "CD-2026-0001" };
  const accountant = { role: "Comptable", schoolCode: "CD-2026-0001" };

  assert.ok(ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("users"));
  assert.ok(ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("notes"));
  assert.ok(SECRETARY_WRITABLE_ENTITIES.includes("students"));
  assert.ok(SECRETARY_WRITABLE_ENTITIES.includes("payments"));
  assert.ok(!SECRETARY_WRITABLE_ENTITIES.includes("notes"));
  assert.ok(!SECRETARY_WRITABLE_ENTITIES.includes("users"));
  assert.ok(!SECRETARY_WRITABLE_ENTITIES.includes("feeGrids"));
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(secretary, ["students", "payments"]).ok,
    true,
  );
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(secretary, ["notes"]).ok,
    false,
  );
  assert.deepStrictEqual(
    evaluateBackOfficeWriteAccess(accountant, ["payments", "studentFees"]).ok,
    true,
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
    true,
  );

  // Pas d'élargissement Secrétaire vs Admin School
  for (const entity of SECRETARY_WRITABLE_ENTITIES) {
    if (entity === "auditLog") continue;
    assert.ok(
      ADMIN_SCHOOL_WRITABLE_ENTITIES.includes(entity),
      `Secrétaire entity ${entity} must be subset of Admin School`,
    );
  }
  for (const entity of ACCOUNTANT_WRITABLE_ENTITIES) {
    if (entity === "auditLog") continue;
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
  const scoped = scopeMvpDatasetForPrincipal(
    {
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
    },
    admin,
    tenantScopeService,
  );
  assert.strictEqual(scoped.students.length, 1);
  assert.strictEqual(scoped.students[0].id, "1");
  assert.strictEqual(scoped.payments.length, 1);
  assert.strictEqual(scoped.school.code, "CD-2026-0001");

  console.log("OK unit: matrice RBAC + scope MVP");
}

async function runHttpTestsIfAvailable() {
  const base = process.env.SOMAFRIK_API_URL || "http://127.0.0.1:5000/api";
  let healthy = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const health = await fetch(`${base.replace(/\/api\/?$/, "")}/api/health`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    healthy = health.ok;
  } catch {
    healthy = false;
  }
  if (!healthy) {
    console.log("SKIP http: API non joignable");
    return;
  }

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
  const secretary = await login("secretaire", "1234", "CD-2026-0001");
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
      pin: "1234",
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

  // Provision Comptable via Admin School PUT (domaine autorisé)
  const stateRes = await request("/backoffice/state", { token: schoolAdmin.accessToken });
  assert.strictEqual(stateRes.status, 200);
  const state = stateRes.data;
  const comptableUser = {
    id: "USER-COMPTABLE-S14",
    publicId: "USR-COMPTABLE-S14",
    firstName: "Compte",
    lastName: "Able",
    role: "Comptable",
    schoolCode: "CD-2026-0001",
    identifier: "comptable-s14",
    email: "comptable-s14@somafrik.app",
    status: "Actif",
    accessChannel: "Application",
    temporaryPassword: "Soma1234",
    mustChangePassword: false,
    permissions: ["Gérer paiements", "Voir rapports financiers", "Paiements:CREATE", "Paiements:UPDATE"],
  };
  const putComptable = await request("/backoffice/state", {
    method: "PUT",
    token: schoolAdmin.accessToken,
    body: {
      users: [...(state.users ?? []).filter((u) => u.id !== comptableUser.id), comptableUser],
    },
  });
  assert.ok(putComptable.status >= 200 && putComptable.status < 300, `create comptable: ${putComptable.status}`);

  const accountant = await login("comptable-s14", "Soma1234", "CD-2026-0001");

  // A1 — Admin School : modification autorisée (students)
  const adminOk = await request("/backoffice/state", {
    method: "PUT",
    token: schoolAdmin.accessToken,
    body: {
      students: state.students ?? [],
    },
  });
  assert.ok(adminOk.status >= 200 && adminOk.status < 300, `Admin School students write: ${adminOk.status}`);

  // A2 — Secrétaire : domaine autorisé (students)
  const secOk = await request("/backoffice/state", {
    method: "PUT",
    token: secretary.accessToken,
    body: {
      students: state.students ?? [],
    },
  });
  assert.ok(secOk.status >= 200 && secOk.status < 300, `Secrétaire students write: ${secOk.status}`);

  // A3 — Secrétaire : domaine interdit (notes) → 403
  const secForbidden = await request("/backoffice/state", {
    method: "PUT",
    token: secretary.accessToken,
    body: {
      notes: [{ id: "NOTE-FORBIDDEN", studentId: "1", value: 10, schoolCode: "CD-2026-0001" }],
    },
  });
  assert.strictEqual(secForbidden.status, 403, "Secrétaire notes doit être 403");

  // A4 — Comptable : paiements OK
  const accOk = await request("/backoffice/state", {
    method: "PUT",
    token: accountant.accessToken,
    body: {
      payments: state.payments ?? [],
    },
  });
  assert.ok(accOk.status >= 200 && accOk.status < 300, `Comptable payments write: ${accOk.status}`);

  // A5 — Comptable : users interdit → 403
  const accForbidden = await request("/backoffice/state", {
    method: "PUT",
    token: accountant.accessToken,
    body: {
      users: state.users ?? [],
    },
  });
  assert.strictEqual(accForbidden.status, 403, "Comptable users doit être 403");

  // A6 — Cross-tenant : secrétaire ne peut pas injecter un élève d'un autre établissement
  // (scoping merge : la ligne hors école ne doit pas apparaître dans l'état scoped)
  const foreignStudent = {
    id: "ELE-FOREIGN-S14",
    publicId: "ELE-FOREIGN-S14",
    name: "Foreign",
    schoolCode: "BI-2026-0001",
    className: "6ème A",
  };
  const crossPut = await request("/backoffice/state", {
    method: "PUT",
    token: secretary.accessToken,
    body: {
      students: [...(state.students ?? []), foreignStudent],
    },
  });
  assert.ok(crossPut.status >= 200 && crossPut.status < 300, "cross put status");
  const afterCross = await request("/backoffice/state", { token: secretary.accessToken });
  const leaked = (afterCross.data.students ?? []).some((s) => s.id === foreignStudent.id);
  assert.strictEqual(leaked, false, "élève hors établissement ne doit pas être accessible");

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

  console.log("OK http: PUT state RBAC + MVP");
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
