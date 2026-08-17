"use strict";

/**
 * P0 — POST /api/presences autorisé depuis role_module_permissions live
 * (overlay requirePermission), sans JWT comme autorité RBAC.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolveEffectivePermissionSet,
  parsePermissionStringsToModuleCrud,
} = require("./functionalRbacResolution");
const { resolveEffectivePermissionsForPrincipal, patchConfiguredPermissions } = require("./functionalRbacService");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { RbacService, routePermissions, PERMISSION_DENIED } = require("../services/rbacService");
const { rolePermissionsDeclared, rolePermissionsForLiveRbac } = require("../data");

const SCHOOL_A = "550e8400-e29b-41d4-a716-446655440001";
const SCHOOL_B = "550e8400-e29b-41d4-a716-446655440002";
const COUNTRY_CD = "550e8400-e29b-41d4-a716-446655440000";
const SCHOOL_CODE_A = "CD-2026-TEST";
const SCHOOL_CODE_B = "CD-2026-OTHER";

const serverSrc = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
const rbac = new RbacService({ rolePermissions: {} });

function sliceFrom(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `bloc introuvable: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  return src.slice(start, end >= 0 ? end : start + 2500);
}

async function authorizeRoute(repo, principal, routeKey) {
  let next = principal;
  const live = await resolveEffectivePermissionsForPrincipal(repo, principal);
  if (Array.isArray(live?.permissions)) {
    next = { ...principal, permissions: live.permissions };
  }
  if (!rbac.canAccess(next, routeKey)) {
    const error = new Error("Permission insuffisante pour cette fonctionnalité.");
    error.statusCode = 403;
    error.code = PERMISSION_DENIED;
    throw error;
  }
  return { principal: next, live };
}

function buildPrefetRepo() {
  const rbacStore = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async ({ schoolCode }) => {
      const code = String(schoolCode ?? "").toUpperCase();
      if (code === SCHOOL_CODE_A) {
        return {
          country: { id: COUNTRY_CD, code: "CD" },
          school: { id: SCHOOL_A, school_code: SCHOOL_CODE_A, country_id: COUNTRY_CD, country_code: "CD" },
        };
      }
      if (code === SCHOOL_CODE_B) {
        return {
          country: { id: COUNTRY_CD, code: "CD" },
          school: { id: SCHOOL_B, school_code: SCHOOL_CODE_B, country_id: COUNTRY_CD, country_code: "CD" },
        };
      }
      return { country: null, school: null };
    },
  });
  const repo = {
    getFunctionalRbacStore: () => rbacStore,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
    listActiveUserRoleKeys: async () => ["PREFET_ETUDES"],
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({}),
    }),
  };
  return { rbacStore, repo };
}

const jwtPrefetA = {
  sub: "prefet-user-id",
  role: "Préfet des études",
  schoolCode: SCHOOL_CODE_A,
  permissions: ["Présences:READ"],
};

test("contrat source : POST /api/presences passe par requirePermission (overlay live)", () => {
  const postBlock = sliceFrom(
    serverSrc,
    'app.post("/api/presences"',
    'app.get("/api/students/:id/report"',
  );
  assert.match(postBlock, /requireAuth/);
  assert.match(postBlock, /requireSchoolSubscriptionFeature\("write_presence"\)/);
  assert.match(postBlock, /requirePermission\("POST \/api\/presences"\)/);
  assert.equal(postBlock.includes("assertCanManagePresences"), false);
});

test("contrat source : GET présences staff et fiche élève passent par requirePermission", () => {
  const getList = sliceFrom(serverSrc, 'app.get("/api/presences"', 'app.post("/api/notes"');
  assert.match(getList, /requirePermission\("GET \/api\/presences"\)/);
  const getStudent = sliceFrom(
    serverSrc,
    'app.get("/api/students/:id/presences"',
    'app.get("/api/students/:id/payments"',
  );
  assert.match(getStudent, /requirePermission\("GET \/api\/students\/:id\/presences"\)/);
});

test("contrat source : requirePermission overlaye le live et pose PERMISSION_DENIED", () => {
  const fnBlock = sliceFrom(serverSrc, "function requirePermission(routeKey)", "function sendList(");
  assert.match(fnBlock, /repository\.resolveEffectivePermissions/);
  assert.match(fnBlock, /denyPermission\(/);
  assert.match(serverSrc, /error\.code = PERMISSION_DENIED/);
});

test("contrat source : POST notes reste sur JWT (bug frère, hors correctif)", () => {
  const notesBlock = sliceFrom(serverSrc, 'app.post("/api/notes"', 'app.post("/api/presences"');
  assert.match(notesBlock, /assertCanManageNotes\(req\.principal\)/);
  assert.equal(notesBlock.includes("requirePermission"), false);
});

test("routePermissions Présences : CREATE OR UPDATE, sans alias legacy", () => {
  assert.deepEqual(routePermissions["GET /api/presences"], [
    "Présences:READ",
    "COUNTRY_PRIVILEGES",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["GET /api/students/:id/presences"], [
    "Présences:READ",
    "COUNTRY_PRIVILEGES",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["POST /api/presences"], [
    "Présences:CREATE",
    "Présences:UPDATE",
    "ALL_PRIVILEGES",
  ]);
  assert.equal(routePermissions["POST /api/presences"].includes("Faire appel"), false);
  assert.equal(routePermissions["POST /api/presences"].includes("Gérer appels"), false);
});

test("GET Présences:READ — SCHOOL_ADMIN, PREFET, TEACHER, PARENT, STUDENT", () => {
  for (const role of ["Admin School", "Préfet des études", "Enseignant", "Parent", "Élève / Étudiant"]) {
    assert.equal(
      rbac.canAccess({ role, permissions: ["Présences:READ"] }, "GET /api/presences"),
      true,
      `${role} GET liste`,
    );
    assert.equal(
      rbac.canAccess({ role, permissions: ["Présences:READ"] }, "GET /api/students/:id/presences"),
      true,
      `${role} GET fiche`,
    );
  }
  assert.equal(
    rbac.canAccess({ role: "Parent", permissions: ["Élèves:READ"] }, "GET /api/presences"),
    false,
  );
});

test("seed Parent/Élève : Présences:READ canonique (parcours lecture)", () => {
  const live = rolePermissionsForLiveRbac();
  const parent = parsePermissionStringsToModuleCrud(live.Parent);
  const student = parsePermissionStringsToModuleCrud(live["Élève / Étudiant"]);
  const admin = parsePermissionStringsToModuleCrud(live["Admin School"]);
  const prefet = parsePermissionStringsToModuleCrud(live["Préfet des études"]);
  const teacher = parsePermissionStringsToModuleCrud(live.Enseignant);
  assert.equal(parent.attendance.canRead, true);
  assert.equal(student.attendance.canRead, true);
  assert.equal(admin.attendance.canRead, true);
  assert.equal(prefet.attendance.canRead, true);
  assert.equal(teacher.attendance.canRead, true);
  assert.ok(rolePermissionsDeclared.Parent.includes("Voir présences"));
});

test("CREATE OR UPDATE : POST autorisé ; ni l'un ni l'autre → 403", () => {
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Présences:CREATE"] }, "POST /api/presences"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Présences:UPDATE"] }, "POST /api/presences"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Présences:READ"] }, "POST /api/presences"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Faire appel"] }, "POST /api/presences"),
    false,
    "aucun alias legacy requis",
  );
});

test("live-change : grant CREATE immédiat puis revoke, même JWT", async () => {
  const { rbacStore, repo } = buildPrefetRepo();
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    updatedBy: "bootstrap",
  });

  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "POST /api/presences"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );

  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      grants: [
        { moduleKey: "attendance", canCreate: true, canRead: true, canUpdate: false, canDelete: false },
      ],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );

  const allowed = await authorizeRoute(repo, jwtPrefetA, "POST /api/presences");
  assert.ok(allowed.live.permissions.includes("Présences:CREATE"));
  assert.equal(jwtPrefetA.permissions.includes("Présences:CREATE"), false, "JWT inchangé");

  const schoolAt = await rbacStore.maxUpdatedAtForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    schoolId: SCHOOL_A,
    countryId: COUNTRY_CD,
  });
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      expectedUpdatedAt: schoolAt,
      grants: [
        { moduleKey: "attendance", canCreate: false, canRead: true, canUpdate: false, canDelete: false },
      ],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );

  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "POST /api/presences"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
});

test("UPDATE seul autorise le POST upsert immédiatement", async () => {
  const { rbacStore, repo } = buildPrefetRepo();
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    updatedBy: "bootstrap",
  });
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      grants: [
        { moduleKey: "attendance", canCreate: false, canRead: true, canUpdate: true, canDelete: false },
      ],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );
  await authorizeRoute(repo, jwtPrefetA, "POST /api/presences");
});

test("grant école A n'autorise pas l'école B ; DENY école prioritaire", async () => {
  const { rbacStore, repo } = buildPrefetRepo();
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "attendance",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    updatedBy: "bootstrap",
  });
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    schoolId: SCHOOL_A,
    countryId: COUNTRY_CD,
    moduleKey: "attendance",
    canCreate: true,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "superadmin",
  });
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    schoolId: SCHOOL_B,
    countryId: COUNTRY_CD,
    moduleKey: "attendance",
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "superadmin",
  });

  await authorizeRoute(repo, jwtPrefetA, "POST /api/presences");
  await assert.rejects(
    () =>
      authorizeRoute(
        repo,
        { ...jwtPrefetA, schoolCode: SCHOOL_CODE_B },
        "POST /api/presences",
      ),
    (error) => error.statusCode === 403,
  );

  const denied = resolveEffectivePermissionSet(
    ["PREFET_ETUDES"],
    await rbacStore.listGrantsForRoles(["PREFET_ETUDES"]),
    { schoolId: SCHOOL_B, countryId: COUNTRY_CD },
  );
  assert.equal(denied.modules.attendance.canCreate, false);
});

test("multi-rôle UNION OR : TEACHER CREATE complète un Préfet READ", () => {
  const resolved = resolveEffectivePermissionSet(
    ["PREFET_ETUDES", "TEACHER"],
    [
      {
        roleKey: "PREFET_ETUDES",
        scopeType: "global",
        moduleKey: "attendance",
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
      },
      {
        roleKey: "TEACHER",
        scopeType: "global",
        moduleKey: "attendance",
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
      },
    ],
    {},
  );
  assert.equal(
    rbac.canAccess(
      { role: "Préfet des études", permissions: resolved.permissions },
      "POST /api/presences",
    ),
    true,
  );
});
