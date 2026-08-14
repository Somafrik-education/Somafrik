/**
 * HOTFIX-RBAC-ADMIN-01 — Création enseignants sans auditLog client.
 * Classes : plus d'écriture via /api/backoffice/state (clôture /api/classes).
 *
 * Usage:
 *   node backend/scripts/verify-rbac-admin-01.js
 *   SOMAFRIK_API_URL=http://127.0.0.1:5000/api node backend/scripts/verify-rbac-admin-01.js
 */
const assert = require("assert");
const path = require("path");
const { assertBackOfficeStateWriteRemoved } = require("../lib/backofficeStatePutExpectation");

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
  assert.ok(ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("teachers"));
  assert.ok(!ADMIN_SCHOOL_WRITABLE_ENTITIES.includes("auditLog"));

  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["classes"]).ok,
    false,
    "Admin School + classes → refusé (legacy fermé)",
  );
  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["teachers"]).ok,
    true,
    "Admin School + teachers",
  );
  assert.strictEqual(
    evaluateBackOfficeWriteAccess(schoolAdmin, ["teachers", "auditLog"]).ok,
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
  // Superadmin matrice théorique peut encore lister la clé, mais le serveur
  // strip/rejette toute écriture classes via state (voir HTTP ci-dessous).
  assert.ok(superWritable.includes("teachers"));
  assert.ok(!superWritable.includes("auditLog"), "Superadmin ne peut pas écrire auditLog client");

  console.log("OK unit: HOTFIX-RBAC-ADMIN-01 matrice teachers/auditLog (+ classes legacy fermé)");
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

  // A1 — Admin établissement + classes seul → 400 legacy fermé
  const classForbidden = await request("/backoffice/state", {
    method: "PUT",
    token: schoolAdmin.accessToken,
    body: {
      classes: [...(state.classes ?? []).filter((row) => row.id !== classId), classRow],
    },
  });
  assert.strictEqual(classForbidden.status, 400, `Admin classes legacy: ${classForbidden.status}`);
  assert.strictEqual(
    classForbidden.data?.code,
    "LEGACY_CLASSES_STATE_WRITE_FORBIDDEN",
    "code legacy classes",
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
      teachers: teacherOk.data.teachers ?? [teacherRow],
      auditLog: [{ id: "AUD-TAMPER", action: "teachers.create" }],
    },
  });
  assert.strictEqual(auditForbidden.status, 403, "Admin + auditLog client doit être 403");
  assert.match(
    String(auditForbidden.data?.message ?? ""),
    /Permission insuffisante/i,
  );

  // A4 — Enseignant + teachers → 403 ; classes → 400 ou 403
  for (const [label, body] of [
    ["classes", { classes: [classRow] }],
    ["teachers", { teachers: [teacherRow] }],
  ]) {
    const forbidden = await request("/backoffice/state", {
      method: "PUT",
      token: teacherToken,
      body,
    });
    if (label === "classes") {
      assert.ok(
        forbidden.status === 400 || forbidden.status === 403,
        `Enseignant + classes doit être 400/403 (reçu ${forbidden.status})`,
      );
    } else {
      assert.strictEqual(forbidden.status, 403, `Enseignant + ${label} doit être 403`);
    }
  }

  // A5 — Superadmin + classes seul → 400 legacy fermé
  const superForbidden = await request("/backoffice/state", {
    method: "PUT",
    token: superadmin.accessToken,
    body: {
      classes: [
        ...(state.classes ?? []),
        { id: `CLS-SUPER-${stamp}`, name: `Super ${stamp}`, schoolCode },
      ],
    },
  });
  assert.strictEqual(superForbidden.status, 400, `Superadmin classes legacy: ${superForbidden.status}`);

  console.log("OK http: HOTFIX-RBAC-ADMIN-01 teachers/auditLog + classes legacy fermé");
}

async function main() {
  runUnitTests();
  await runHttpTestsIfAvailable();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
