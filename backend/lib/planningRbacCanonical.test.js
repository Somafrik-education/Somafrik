"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parsePermissionStringsToModuleCrud,
} = require("./functionalRbacResolution");
const {
  ensureFunctionalRbacBootstrap,
  resolveEffectivePermissionsForPrincipal,
} = require("./functionalRbacService");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { rolePermissionsDeclared, rolePermissionsForLiveRbac } = require("../data");
const { RbacService } = require("../services/rbacService");
const {
  CANONICAL_PLANNING_ROLE_GRANTS,
  PLANNING_MODULE_KEY,
} = require("./planningRbacCanonical");

const rbac = new RbacService({ rolePermissions: {} });

function staleCatalogRepo(store) {
  return {
    getFunctionalRbacStore: () => store,
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({
        "Préfet des études": ["Voir notes", "Voir présences"],
        PREFET_ETUDES: ["Voir notes", "Voir présences"],
        Enseignant: ["Voir notes"],
        TEACHER: ["Voir notes"],
        Secrétaire: ["Élèves:READ"],
        SECRETARY: ["Élèves:READ"],
        Parent: ["Voir notes"],
        PARENT: ["Voir notes"],
        "Admin School": [],
        SCHOOL_ADMIN: [],
      }),
      getRoleByNameOrCode: async () => ({ id: "existing" }),
      insertRole: async () => {},
      markSystemProtected: async () => true,
    }),
    listActiveUserRoleKeys: async () => null,
  };
}

async function seedPreMigrationGrants(store) {
  await store.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    canUpdate: true,
    updatedBy: "pre-migration",
  });
  await store.upsertGrant({
    roleKey: "TEACHER",
    scopeType: "global",
    moduleKey: "grades",
    canRead: true,
    updatedBy: "pre-migration",
  });
  await store.upsertGrant({
    roleKey: "SECRETARY",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    updatedBy: "pre-migration",
  });
  await store.upsertGrant({
    roleKey: "PARENT",
    scopeType: "global",
    moduleKey: "grades",
    canRead: true,
    updatedBy: "pre-migration",
  });
  await store.upsertGrant({
    roleKey: "SCHOOL_ADMIN",
    scopeType: "global",
    moduleKey: "planning",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "pre-migration",
  });
}

function planningTokens(permissions) {
  return (permissions || []).filter((token) => String(token).startsWith("Planning de cours:"));
}

test("carte data.js : Préfet CRUD Planning, Enseignant READ, pas Parent/Secrétaire", () => {
  const live = rolePermissionsForLiveRbac();
  const declaredPrefet = parsePermissionStringsToModuleCrud(rolePermissionsDeclared["Préfet des études"]);
  const declaredTeacher = parsePermissionStringsToModuleCrud(rolePermissionsDeclared.Enseignant);
  const liveAdmin = parsePermissionStringsToModuleCrud(live["Admin School"]);
  const liveParent = parsePermissionStringsToModuleCrud(live.Parent);
  const liveSecretary = parsePermissionStringsToModuleCrud(live.Secrétaire);

  assert.deepEqual(declaredPrefet.planning, CANONICAL_PLANNING_ROLE_GRANTS.PREFET_ETUDES);
  assert.deepEqual(declaredTeacher.planning, CANONICAL_PLANNING_ROLE_GRANTS.TEACHER);
  assert.equal(liveAdmin.planning.canRead, true);
  assert.equal(liveAdmin.planning.canCreate, true);
  assert.equal(liveAdmin.planning.canDelete, true);
  assert.equal(liveParent.planning?.canRead, false);
  assert.equal(liveSecretary.planning?.canRead, false);
});

test("bootstrap réconcilie Planning pour un Préfet/Enseignant déjà présents (catalogue périmé)", async () => {
  const store = createFunctionalRbacMemoryStore();
  await seedPreMigrationGrants(store);
  const before = await store.listGrantsForRoles(["PREFET_ETUDES", "TEACHER"]);
  assert.equal(
    before.some((row) => row.moduleKey === PLANNING_MODULE_KEY),
    false,
    "pré-migration : aucun grant planning Prefet/Teacher",
  );

  const repo = staleCatalogRepo(store);
  await ensureFunctionalRbacBootstrap(repo);
  const countAfterFirst = await store.countActiveGrants();
  await ensureFunctionalRbacBootstrap(repo);
  assert.equal(await store.countActiveGrants(), countAfterFirst, "réconciliation idempotente");

  const prefet = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Préfet des études",
    roleKeys: ["PREFET_ETUDES"],
  });
  assert.deepEqual(planningTokens(prefet.permissions).sort(), [
    "Planning de cours:CREATE",
    "Planning de cours:DELETE",
    "Planning de cours:READ",
    "Planning de cours:UPDATE",
  ]);

  const teacher = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Enseignant",
    roleKeys: ["TEACHER"],
  });
  assert.deepEqual(planningTokens(teacher.permissions), ["Planning de cours:READ"]);
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: teacher.permissions }, "GET /api/course-schedules"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: teacher.permissions }, "POST /api/course-schedules"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: teacher.permissions }, "PATCH /api/course-schedules/:scheduleId"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: teacher.permissions }, "DELETE /api/course-schedules/:scheduleId"),
    false,
  );

  const secretary = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Secrétaire",
    roleKeys: ["SECRETARY"],
  });
  assert.deepEqual(planningTokens(secretary.permissions), []);

  const parent = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Parent",
    roleKeys: ["PARENT"],
  });
  assert.deepEqual(planningTokens(parent.permissions), []);

  const admin = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
  });
  assert.ok(admin.permissions.includes("Planning de cours:READ"));
  assert.ok(admin.permissions.includes("Planning de cours:CREATE"));
});

test("réconciliation UNION : un DENY planning héritée devient le canonique Préfet CRUD", async () => {
  const store = createFunctionalRbacMemoryStore();
  await store.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    updatedBy: "pre-migration",
  });
  await store.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "planning",
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
    updatedBy: "pre-migration",
  });
  const repo = staleCatalogRepo(store);
  await ensureFunctionalRbacBootstrap(repo);
  const live = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Préfet des études",
    roleKeys: ["PREFET_ETUDES"],
  });
  assert.ok(live.permissions.includes("Planning de cours:READ"));
  assert.ok(live.permissions.includes("Planning de cours:CREATE"));
  assert.ok(live.permissions.includes("Planning de cours:DELETE"));
});
