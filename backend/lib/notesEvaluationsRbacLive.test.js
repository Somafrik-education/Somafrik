"use strict";

/**
 * P0 — POST /api/notes et POST/PATCH /api/evaluations autorisés depuis
 * role_module_permissions live (overlay requirePermission).
 * JWT = identité / session / scope uniquement.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  resolveEffectivePermissionSet,
  parsePermissionStringsToModuleCrud,
  flattenModulesToTokens,
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

function buildPrefetRepo(listActiveUserRoleKeys = async () => ["PREFET_ETUDES"]) {
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
    listActiveUserRoleKeys,
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
  permissions: ["Notes:READ"],
};

test("contrat source : POST /api/notes overlaye le live via requirePermission", () => {
  const notesBlock = sliceFrom(serverSrc, 'app.post("/api/notes"', 'app.post("/api/presences"');
  assert.match(notesBlock, /requireAuth/);
  assert.match(notesBlock, /requireSchoolSubscriptionFeature\("write_notes"\)/);
  assert.match(notesBlock, /requirePermission\("POST \/api\/notes"\)/);
  assert.equal(notesBlock.includes("assertCanManageNotes"), false);
});

test("contrat source : POST/PATCH evaluations overlayent le live", () => {
  const postEval = sliceFrom(serverSrc, 'app.post("/api/evaluations"', 'app.patch("/api/evaluations/:evaluationId"');
  assert.match(postEval, /requirePermission\("POST \/api\/evaluations"\)/);
  assert.equal(postEval.includes("assertCanManageNotes"), false);
  const patchEval = sliceFrom(serverSrc, 'app.patch("/api/evaluations/:evaluationId"', 'app.get("/api/assignments"');
  assert.match(patchEval, /requirePermission\("PATCH \/api\/evaluations\/:evaluationId"\)/);
  assert.equal(patchEval.includes("assertCanManageNotes"), false);
});

test("contrat source : GET notes staff et fiche élève passent par requirePermission", () => {
  const getStudent = sliceFrom(serverSrc, 'app.get("/api/students/:id/notes"', 'app.get("/api/notes"');
  assert.match(getStudent, /requirePermission\("GET \/api\/students\/:id\/notes"\)/);
  const getList = sliceFrom(serverSrc, 'app.get("/api/notes"', 'app.get("/api/presences"');
  assert.match(getList, /requirePermission\("GET \/api\/notes"\)/);
});

test("assertCanManageNotes n'existe plus dans server.js", () => {
  assert.equal(serverSrc.includes("function assertCanManageNotes"), false);
  assert.equal(serverSrc.includes("assertCanManageNotes("), false);
});

test("routePermissions Notes : CREATE OR UPDATE, sans alias legacy", () => {
  assert.deepEqual(routePermissions["GET /api/notes"], [
    "Notes:READ",
    "COUNTRY_PRIVILEGES",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["GET /api/students/:id/notes"], [
    "Notes:READ",
    "COUNTRY_PRIVILEGES",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["POST /api/notes"], [
    "Notes:CREATE",
    "Notes:UPDATE",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["POST /api/evaluations"], [
    "Notes:CREATE",
    "Notes:UPDATE",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["PATCH /api/evaluations/:evaluationId"], [
    "Notes:UPDATE",
    "ALL_PRIVILEGES",
  ]);
  assert.equal(routePermissions["POST /api/notes"].includes("Modifier notes"), false);
  assert.equal(routePermissions["POST /api/notes"].includes("Notes:CRUD"), false);
  assert.equal(routePermissions["POST /api/evaluations"].includes("Evaluations:CRUD"), false);
});

test("module_key canonique grades → jeton Notes:CREATE (pas evaluations)", () => {
  const tokens = flattenModulesToTokens({
    grades: { canCreate: true, canRead: true, canUpdate: false, canDelete: false },
  });
  assert.ok(tokens.includes("Notes:CREATE"));
  assert.ok(tokens.includes("Notes:READ"));
  assert.equal(tokens.includes("Notes:UPDATE"), false);
  assert.equal(tokens.includes("Evaluations:CREATE"), false);
});

test("GET Notes:READ — SCHOOL_ADMIN, PREFET, TEACHER, PARENT, STUDENT", () => {
  for (const role of ["Admin School", "Préfet des études", "Enseignant", "Parent", "Élève / Étudiant"]) {
    assert.equal(
      rbac.canAccess({ role, permissions: ["Notes:READ"] }, "GET /api/notes"),
      true,
      `${role} GET liste`,
    );
    assert.equal(
      rbac.canAccess({ role, permissions: ["Notes:READ"] }, "GET /api/students/:id/notes"),
      true,
      `${role} GET fiche`,
    );
  }
  assert.equal(rbac.canAccess({ role: "Parent", permissions: ["Élèves:READ"] }, "GET /api/notes"), false);
});

test("seed Parent/Élève : Notes:READ canonique (parcours lecture)", () => {
  const live = rolePermissionsForLiveRbac();
  const parent = parsePermissionStringsToModuleCrud(live.Parent);
  const student = parsePermissionStringsToModuleCrud(live["Élève / Étudiant"]);
  const admin = parsePermissionStringsToModuleCrud(live["Admin School"]);
  const prefet = parsePermissionStringsToModuleCrud(live["Préfet des études"]);
  const teacher = parsePermissionStringsToModuleCrud(live.Enseignant);
  assert.equal(parent.grades.canRead, true);
  assert.equal(student.grades.canRead, true);
  assert.equal(admin.grades.canRead, true);
  assert.equal(prefet.grades.canRead, true);
  assert.equal(teacher.grades.canRead, true);
  assert.ok(rolePermissionsDeclared.Parent.includes("Voir notes"));
  assert.ok(rolePermissionsDeclared["Élève / Étudiant"].includes("Voir notes"));
});

test("CREATE OR UPDATE : POST notes autorisé ; ni l'un ni l'autre → 403", () => {
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Notes:CREATE"] }, "POST /api/notes"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Notes:UPDATE"] }, "POST /api/notes"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Notes:READ"] }, "POST /api/notes"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Modifier notes"] }, "POST /api/notes"),
    false,
    "aucun alias legacy requis",
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Notes:CREATE"] }, "POST /api/evaluations"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Notes:READ"] }, "PATCH /api/evaluations/:evaluationId"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: ["Notes:UPDATE"] }, "PATCH /api/evaluations/:evaluationId"),
    true,
  );
});

test("live-change : grant CREATE immédiat puis revoke, même JWT", async () => {
  const { rbacStore, repo } = buildPrefetRepo();
  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "POST /api/notes"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "POST /api/evaluations"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );

  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      grants: [{ moduleKey: "grades", canCreate: true, canRead: true, canUpdate: false, canDelete: false }],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );

  const allowed = await authorizeRoute(repo, jwtPrefetA, "POST /api/notes");
  assert.ok(allowed.live.permissions.includes("Notes:CREATE"));
  assert.equal(jwtPrefetA.permissions.includes("Notes:CREATE"), false, "JWT inchangé");
  await authorizeRoute(repo, jwtPrefetA, "POST /api/evaluations");
  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "PATCH /api/evaluations/:evaluationId"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
    "PATCH evaluations exige Notes:UPDATE",
  );

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
      grants: [{ moduleKey: "grades", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );

  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "POST /api/notes"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
});

test("UPDATE seul autorise le POST notes upsert immédiatement", async () => {
  const { repo } = buildPrefetRepo();
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      grants: [{ moduleKey: "grades", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );
  await authorizeRoute(repo, jwtPrefetA, "POST /api/notes");
  await authorizeRoute(repo, jwtPrefetA, "PATCH /api/evaluations/:evaluationId");
});

test("grant école A n'autorise pas l'école B ; DENY école prioritaire", async () => {
  const { rbacStore, repo } = buildPrefetRepo();
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "grades",
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
    moduleKey: "grades",
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
    moduleKey: "grades",
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "superadmin",
  });

  await authorizeRoute(repo, jwtPrefetA, "POST /api/notes");
  await assert.rejects(
    () => authorizeRoute(repo, { ...jwtPrefetA, schoolCode: SCHOOL_CODE_B }, "POST /api/notes"),
    (error) => error.statusCode === 403,
  );

  const grants = await rbacStore.listGrantsForRoles(["PREFET_ETUDES"]);
  const denied = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants, {
    schoolId: SCHOOL_B,
    countryId: COUNTRY_CD,
  });
  assert.equal(denied.modules.grades.canCreate, false);
});

test("multi-rôle UNION OR : TEACHER CREATE complète un Préfet READ ; rôle révoqué ignoré", async () => {
  const { rbacStore, repo } = buildPrefetRepo(async () => ["PREFET_ETUDES", "TEACHER"]);
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "grades",
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "bootstrap",
  });
  await rbacStore.upsertGrant({
    roleKey: "TEACHER",
    scopeType: "global",
    moduleKey: "grades",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    updatedBy: "bootstrap",
  });
  const allowed = await authorizeRoute(repo, jwtPrefetA, "POST /api/notes");
  assert.ok(allowed.live.permissions.includes("Notes:CREATE"));

  repo.listActiveUserRoleKeys = async () => ["PREFET_ETUDES"];
  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "POST /api/notes"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
});

test("GET notes live : grant READ immédiat même JWT", async () => {
  const { repo } = buildPrefetRepo();
  const jwtNoRead = { ...jwtPrefetA, permissions: [] };
  await assert.rejects(
    () => authorizeRoute(repo, jwtNoRead, "GET /api/notes"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      grants: [{ moduleKey: "grades", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );
  await authorizeRoute(repo, jwtNoRead, "GET /api/notes");
  await authorizeRoute(repo, jwtNoRead, "GET /api/students/:id/notes");
});

test("abonnement write_notes : 403 distinct de PERMISSION_DENIED", () => {
  const { assertSchoolFeature, BLOCKED_MESSAGE } = require("../services/schoolSubscriptionAccessService");
  assert.throws(
    () =>
      assertSchoolFeature(
        "CD-2026-0001",
        {
          schools: [{ code: "CD-2026-0001", status: "Suspendu" }],
          subscriptions: [{ schoolCode: "CD-2026-0001", accessLevel: "blocked", lifecycleStatus: "Suspendu" }],
        },
        "write_notes",
      ),
    (error) =>
      error.statusCode === 403 &&
      error.code !== PERMISSION_DENIED &&
      String(error.message) === BLOCKED_MESSAGE,
  );
  const notesBlock = sliceFrom(serverSrc, 'app.post("/api/notes"', 'app.post("/api/presences"');
  const subIdx = notesBlock.indexOf('requireSchoolSubscriptionFeature("write_notes")');
  const rbacIdx = notesBlock.indexOf('requirePermission("POST /api/notes")');
  assert.ok(subIdx >= 0 && rbacIdx > subIdx, "write_notes avant requirePermission");
});
