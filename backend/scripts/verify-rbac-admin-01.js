/**
 * HOTFIX-RBAC-ADMIN-01 — Création classes/enseignants sans auditLog client.
 *
 * Usage:
 *   node backend/scripts/verify-rbac-admin-01.js
 *   SOMAFRIK_API_URL=http://127.0.0.1:5000/api node backend/scripts/verify-rbac-admin-01.js
 */
const assert = require("assert");
const path = require("path");

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

  assert.ok(ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("classes"));
  assert.ok(ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("teachers"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("auditLog"));

  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["classes"]).ok,
    true,
    "Admin School + classes",
  );
  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["teachers"]).ok,
    true,
    "Admin School + teachers",
  );
  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["classes", "auditLog"]).ok,
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
  assert.ok(superWritable.includes("classes"));
  assert.ok(superWritable.includes("teachers"));
  assert.ok(!superWritable.includes("auditLog"), "Superadmin ne peut pas écrire auditLog client");

  console.log("OK unit: HOTFIX-RBAC-ADMIN-01 matrice classes/teachers/auditLog");
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
  const superadmin = await login("superadmin@somafrik.app", "1234");
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

  const stateRes = await request("/backoffice/state", { token: schoolAdmin.accessToken });
  assert.strictEqual(stateRes.status, 200);
  const state = stateRes.data;
  const stamp = Date.now().toString(36);
  const schoolCode = "CD-2026-0001";

  const classId = `CLS-RBAC-ADMIN-01-${stamp}`;
  const classRow = {
    id: classId,
    name: `2ème A ${stamp}`,
    schoolCode,
    level: "2ème",
    capacity: 40,
  };

  // A1 — Admin établissement + classes (sans auditLog) → 200
  const classOk = await request("/backoffice/state", {
    method: "PUT",
    token: schoolAdmin.accessToken,
    body: {
      classes: [...(state.classes ?? []).filter((row) => row.id !== classId), classRow],
    },
  });
  assert.ok(classOk.status >= 200 && classOk.status < 300, `Admin classes: ${classOk.status}`);
  assert.ok(
    (classOk.data.classes ?? []).some((row) => row.id === classId),
    "classe persistée dans la réponse",
  );

  // A2 — Admin établissement + enseignants (sans auditLog) → 200
  const teacherId = `TCH-RBAC-ADMIN-01-${stamp}`;
  const teacherRow = {
    id: teacherId,
    publicId: `ENS-RBAC-${stamp}`,
    name: "Test",
    firstName: "RBAC",
    schoolCode,
    status: "Actif",
  };
  const teacherOk = await request("/backoffice/state", {
    method: "PUT",
    token: schoolAdmin.accessToken,
    body: {
      teachers: [...(state.teachers ?? []).filter((row) => row.id !== teacherId), teacherRow],
    },
  });
  assert.ok(teacherOk.status >= 200 && teacherOk.status < 300, `Admin teachers: ${teacherOk.status}`);

  // A3 — Admin + auditLog client → 403 explicite
  const auditForbidden = await request("/backoffice/state", {
    method: "PUT",
    token: schoolAdmin.accessToken,
    body: {
      classes: classOk.data.classes ?? [classRow],
      auditLog: [{ id: "AUD-TAMPER", action: "classes.create" }],
    },
  });
  assert.strictEqual(auditForbidden.status, 403, "Admin + auditLog client doit être 403");
  assert.match(
    String(auditForbidden.data?.message ?? ""),
    /Permission insuffisante/i,
  );

  // A4 — Admin + autre école → ligne étrangère non persistée (scope)
  const foreignClass = {
    id: `CLS-FOREIGN-${stamp}`,
    name: "Foreign",
    schoolCode: "BI-2026-0001",
  };
  const crossPut = await request("/backoffice/state", {
    method: "PUT",
    token: schoolAdmin.accessToken,
    body: {
      classes: [...(classOk.data.classes ?? []), foreignClass],
    },
  });
  assert.ok(crossPut.status >= 200 && crossPut.status < 300, "cross put status");
  const afterCross = await request("/backoffice/state", { token: schoolAdmin.accessToken });
  assert.strictEqual(
    (afterCross.data.classes ?? []).some((row) => row.id === foreignClass.id),
    false,
    "classe autre école non accessible (scoped)",
  );

  // A5 — Enseignant + classes/enseignants → 403
  for (const [label, body] of [
    ["classes", { classes: [classRow] }],
    ["teachers", { teachers: [teacherRow] }],
  ]) {
    const forbidden = await request("/backoffice/state", {
      method: "PUT",
      token: teacherToken,
      body,
    });
    assert.strictEqual(forbidden.status, 403, `Enseignant + ${label} doit être 403`);
  }

  // A6 — Superadmin + classes → 200
  const superClassId = `CLS-SUPER-${stamp}`;
  const superOk = await request("/backoffice/state", {
    method: "PUT",
    token: superadmin.accessToken,
    body: {
      classes: [
        ...(afterCross.data.classes ?? []),
        { id: superClassId, name: `Super ${stamp}`, schoolCode },
      ],
    },
  });
  assert.ok(superOk.status >= 200 && superOk.status < 300, `Superadmin classes: ${superOk.status}`);

  console.log("OK http: HOTFIX-RBAC-ADMIN-01 classes/teachers/auditLog");
}

async function main() {
  runUnitTests();
  await runHttpTestsIfAvailable();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
