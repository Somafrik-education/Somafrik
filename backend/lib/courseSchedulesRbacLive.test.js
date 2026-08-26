"use strict";

/**
 * P0 — écritures /api/course-schedules fail-closed via Planning de cours:*.
 * Pas d'alias « Gérer planning académique » comme autorité.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const {
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

function buildRepo(listActiveUserRoleKeys = async () => ["PREFET_ETUDES"]) {
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

test("contrat source : GET/POST/PATCH/DELETE course-schedules overlayent requirePermission", () => {
  const getBlock = sliceFrom(serverSrc, 'app.get("/api/course-schedules"', 'app.post("/api/courses"');
  assert.match(getBlock, /requireAuth/);
  assert.match(getBlock, /requirePermission\("GET \/api\/course-schedules"\)/);

  const postBlock = sliceFrom(serverSrc, 'app.post("/api/course-schedules"', 'app.patch("/api/course-schedules/:scheduleId"');
  assert.match(postBlock, /requirePermission\("POST \/api\/course-schedules"\)/);

  const patchBlock = sliceFrom(serverSrc, 'app.patch("/api/course-schedules/:scheduleId"', 'app.delete("/api/course-schedules/:scheduleId"');
  assert.match(patchBlock, /requirePermission\("PATCH \/api\/course-schedules\/:scheduleId"\)/);

  const deleteBlock = sliceFrom(serverSrc, 'app.delete("/api/course-schedules/:scheduleId"', 'app.get("/api/evaluations"');
  assert.match(deleteBlock, /requirePermission\("DELETE \/api\/course-schedules\/:scheduleId"\)/);
});

test("routePermissions Planning de cours : CRUD canonique, sans alias legacy", () => {
  assert.deepEqual(routePermissions["GET /api/course-schedules"], [
    "Planning de cours:READ",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["GET /api/mobile-sync/l1/course-schedules"], [
    "Planning de cours:READ",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["POST /api/course-schedules"], [
    "Planning de cours:CREATE",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["PATCH /api/course-schedules/:scheduleId"], [
    "Planning de cours:UPDATE",
    "ALL_PRIVILEGES",
  ]);
  assert.deepEqual(routePermissions["DELETE /api/course-schedules/:scheduleId"], [
    "Planning de cours:DELETE",
    "ALL_PRIVILEGES",
  ]);
  for (const key of [
    "GET /api/course-schedules",
    "POST /api/course-schedules",
    "PATCH /api/course-schedules/:scheduleId",
    "DELETE /api/course-schedules/:scheduleId",
  ]) {
    assert.equal(routePermissions[key].includes("Gérer planning académique"), false, key);
    assert.equal(routePermissions[key].includes("COUNTRY_PRIVILEGES"), false, key);
  }
});

test("matrice live : Admin/Préfet CRUD, Enseignant READ, Parent/Élève/Secrétaire deny", () => {
  const live = rolePermissionsForLiveRbac();
  const admin = parsePermissionStringsToModuleCrud(live["Admin School"]);
  const prefet = parsePermissionStringsToModuleCrud(live["Préfet des études"]);
  const teacher = parsePermissionStringsToModuleCrud(live.Enseignant);
  const secretary = parsePermissionStringsToModuleCrud(live.Secrétaire);
  const parent = parsePermissionStringsToModuleCrud(live.Parent);
  const student = parsePermissionStringsToModuleCrud(live["Élève / Étudiant"]);
  const directeur = parsePermissionStringsToModuleCrud(live.Directeur);

  assert.equal(admin.planning.canRead, true);
  assert.equal(admin.planning.canCreate, true);
  assert.equal(admin.planning.canUpdate, true);
  assert.equal(admin.planning.canDelete, true);

  assert.equal(prefet.planning.canRead, true);
  assert.equal(prefet.planning.canCreate, true);
  assert.equal(prefet.planning.canUpdate, true);
  assert.equal(prefet.planning.canDelete, true);

  assert.equal(teacher.planning.canRead, true);
  assert.equal(teacher.planning.canCreate, false);
  assert.equal(teacher.planning.canUpdate, false);
  assert.equal(teacher.planning.canDelete, false);

  assert.equal(secretary.planning.canRead, false);
  assert.equal(parent.planning.canRead, false);
  assert.equal(student.planning.canRead, false);
  assert.equal(
    directeur.planning.canRead,
    false,
    "Directeur live = declared, pas d'invention Planning",
  );

  assert.ok(rolePermissionsDeclared["Préfet des études"].includes("Planning de cours:CREATE"));
  assert.ok(rolePermissionsDeclared.Enseignant.includes("Planning de cours:READ"));
  assert.equal(rolePermissionsDeclared.Enseignant.includes("Planning de cours:CREATE"), false);
  assert.ok(rolePermissionsDeclared["Préfet des études"].includes("Gérer planning académique"));
});

test("Gérer planning académique n'autorise plus les écritures course-schedules", () => {
  assert.equal(
    rbac.canAccess(
      { role: "Préfet des études", permissions: ["Gérer planning académique"] },
      "POST /api/course-schedules",
    ),
    false,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Gérer planning académique"] },
      "GET /api/course-schedules",
    ),
    false,
  );
});

test("canAccess : Admin/Préfet CRUD, Enseignant READ, Parent deny", () => {
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Planning de cours:CREATE"] }, "POST /api/course-schedules"),
    true,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Préfet des études", permissions: ["Planning de cours:CREATE"] },
      "POST /api/course-schedules",
    ),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Planning de cours:READ"] }, "GET /api/course-schedules"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Planning de cours:READ"] }, "POST /api/course-schedules"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Planning de cours:READ"] }, "PATCH /api/course-schedules/:scheduleId"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Planning de cours:READ"] }, "DELETE /api/course-schedules/:scheduleId"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Parent", permissions: ["Élèves:READ"] }, "GET /api/course-schedules"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Parent", permissions: ["Élèves:READ"] }, "POST /api/course-schedules"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Secrétaire", permissions: ["Élèves:READ"] }, "GET /api/course-schedules"),
    false,
  );
});

test("live-change : grant CREATE immédiat puis revoke, même JWT Préfet", async () => {
  const { rbacStore, repo } = buildRepo();
  await rbacStore.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "planning",
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "bootstrap",
  });
  const jwtPrefetA = {
    sub: "prefet-planning-user",
    role: "Préfet des études",
    schoolCode: SCHOOL_CODE_A,
    permissions: ["Planning de cours:READ"],
  };

  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "POST /api/course-schedules"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );

  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      grants: [
        {
          moduleKey: "planning",
          canCreate: true,
          canRead: true,
          canUpdate: true,
          canDelete: true,
        },
      ],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );

  await authorizeRoute(repo, jwtPrefetA, "POST /api/course-schedules");
  await authorizeRoute(repo, jwtPrefetA, "PATCH /api/course-schedules/:scheduleId");
  await authorizeRoute(repo, jwtPrefetA, "DELETE /api/course-schedules/:scheduleId");

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
        {
          moduleKey: "planning",
          canCreate: false,
          canRead: true,
          canUpdate: false,
          canDelete: false,
        },
      ],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );

  await assert.rejects(
    () => authorizeRoute(repo, jwtPrefetA, "POST /api/course-schedules"),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
  await authorizeRoute(repo, jwtPrefetA, "GET /api/course-schedules");
});

test("tenant : grant établissement A n'autorise pas établissement B", async () => {
  const { repo } = buildRepo();
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: SCHOOL_CODE_A,
      grants: [{ moduleKey: "planning", canCreate: true, canRead: true, canUpdate: true, canDelete: true }],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );

  await authorizeRoute(
    repo,
    { sub: "prefet-a", role: "Préfet des études", schoolCode: SCHOOL_CODE_A, permissions: [] },
    "POST /api/course-schedules",
  );

  await assert.rejects(
    () =>
      authorizeRoute(
        repo,
        { sub: "prefet-b", role: "Préfet des études", schoolCode: SCHOOL_CODE_B, permissions: [] },
        "POST /api/course-schedules",
      ),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
});
