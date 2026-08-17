"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { FUNCTIONAL_RBAC_ERROR } = require("./functionalRbacManagement");
const {
  listRbacCatalog,
  getConfiguredPermissions,
  patchConfiguredPermissions,
} = require("./functionalRbacService");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const {
  mandatoryPermissionsForRole,
  MODULE_ACTION_DEPENDENCIES,
  LOCK_KIND,
  describeActionLocks,
  assertMandatoryPermissionPatch,
} = require("./rbacMandatoryPermissions");

const SUPER_ADMIN = { role: "Super Administrateur Somafrik", identifier: "superadmin" };

function memoryRepo() {
  const rbac = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async () => ({
      country: { id: "cd", code: "CD" },
      school: { id: "nuru", school_code: "CD-2026-0001", country_id: "cd", country_code: "CD" },
    }),
  });
  const repo = {
    getFunctionalRbacStore: () => rbac,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
    listEstablishmentRoles: async () => [
      { id: "r1", roleCode: "SUPER_ADMIN", roleName: "Super Administrateur Somafrik", scope: "platform", status: "active" },
      { id: "r2", roleCode: "PREFET_ETUDES", roleName: "Préfet des études", scope: "school", status: "active" },
    ],
  };
  return { repo, rbac };
}

test("mandatoryPermissionsForRole : SUPER_ADMIN uniquement, rien inventé pour SCHOOL/COUNTRY_ADMIN", () => {
  const superAdmin = mandatoryPermissionsForRole("SUPER_ADMIN");
  assert.equal(superAdmin.users.read, true);
  assert.equal(superAdmin.users.create, true);
  assert.equal(superAdmin.users.update, true);
  assert.equal(superAdmin.users.delete, true);
  assert.equal(superAdmin.role_permissions.read, true);
  assert.equal(superAdmin.role_permissions.update, true);
  assert.equal(superAdmin.role_permissions.delete, false);
  assert.equal(superAdmin.countries.read, true);
  assert.equal(superAdmin.countries.delete, false);
  assert.equal(superAdmin.schools.read, true);
  assert.equal(superAdmin.education_reference.read, true);
  assert.deepEqual(mandatoryPermissionsForRole("SCHOOL_ADMIN"), {});
  assert.deepEqual(mandatoryPermissionsForRole("COUNTRY_ADMIN"), {});
  assert.deepEqual(mandatoryPermissionsForRole("PREFET_ETUDES"), {});
});

test("dépendances intra-module : CREATE/UPDATE/DELETE → READ", () => {
  assert.deepEqual(MODULE_ACTION_DEPENDENCIES.create, ["read"]);
  assert.deepEqual(MODULE_ACTION_DEPENDENCIES.update, ["read"]);
  assert.deepEqual(MODULE_ACTION_DEPENDENCIES.delete, ["read"]);
  const locks = describeActionLocks({
    roleKey: "PREFET_ETUDES",
    moduleKey: "attendance",
    flags: { canCreate: true, canRead: true, canUpdate: false, canDelete: false },
  });
  assert.equal(locks.read.locked, true);
  assert.equal(locks.read.reason, LOCK_KIND.DEPENDENCY);
  assert.equal(locks.create.locked, false);
});

test("PATCH refuse invariant SUPER_ADMIN sans écriture — MANDATORY_PERMISSION", async () => {
  const { repo, rbac } = memoryRepo();
  await rbac.upsertGrant({
    roleKey: "SUPER_ADMIN",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
    moduleKey: "users",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "bootstrap",
  });
  const before = await rbac.listGrantsForScope({
    roleKey: "SUPER_ADMIN",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  });
  await assert.rejects(
    () =>
      patchConfiguredPermissions(
        repo,
        {
          roleKey: "SUPER_ADMIN",
          countryCode: "CD",
          schoolCode: "CD-2026-0001",
          grants: [{ moduleKey: "users", canCreate: true, canRead: false, canUpdate: true, canDelete: true }],
        },
        SUPER_ADMIN,
        {},
      ),
    (error) =>
      error.statusCode === 409 &&
      error.code === FUNCTIONAL_RBAC_ERROR.MANDATORY_PERMISSION &&
      error.details?.lockKind === LOCK_KIND.ROLE_INVARIANT &&
      error.details?.legacyCode === FUNCTIONAL_RBAC_ERROR.SUPER_ADMIN_INVARIANT,
  );
  const after = await rbac.listGrantsForScope({
    roleKey: "SUPER_ADMIN",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  });
  assert.equal(after.find((row) => row.moduleKey === "users").canRead, true);
  assert.equal(after.length, before.length);
});

test("PATCH refuse CREATE sans READ — MANDATORY_PERMISSION dependency", async () => {
  const { repo, rbac } = memoryRepo();
  await assert.rejects(
    () =>
      patchConfiguredPermissions(
        repo,
        {
          roleKey: "PREFET_ETUDES",
          countryCode: "CD",
          schoolCode: "CD-2026-0001",
          grants: [
            { moduleKey: "attendance", canCreate: true, canRead: false, canUpdate: false, canDelete: false },
          ],
        },
        SUPER_ADMIN,
        {},
      ),
    (error) =>
      error.statusCode === 409 &&
      error.code === FUNCTIONAL_RBAC_ERROR.MANDATORY_PERMISSION &&
      error.details?.lockKind === LOCK_KIND.DEPENDENCY,
  );
  const grants = await rbac.listGrantsForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  });
  assert.equal(grants.find((row) => row.moduleKey === "attendance"), undefined);
});

test("PATCH facultatif autorisé : CREATE+READ puis retrait CREATE", async () => {
  const { repo, rbac } = memoryRepo();
  const created = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "attendance", canCreate: true, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER_ADMIN,
    {},
  );
  assert.ok(created.updatedAt);
  const revoked = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      expectedUpdatedAt: created.updatedAt,
      grants: [{ moduleKey: "attendance", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER_ADMIN,
    {},
  );
  assert.ok(revoked.updatedAt);
  const row = (await rbac.listGrantsForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  })).find((item) => item.moduleKey === "attendance");
  assert.equal(row.canCreate, false);
  assert.equal(row.canRead, true);
});

test("catalogue expose mandatoryByRole + dependencies", async () => {
  const { repo, rbac } = memoryRepo();
  await rbac.seedFunctionalModules();
  const catalog = await listRbacCatalog(repo, SUPER_ADMIN);
  assert.equal(catalog.mandatoryByRole.SUPER_ADMIN.users.read, true);
  assert.deepEqual(catalog.mandatoryByRole.SCHOOL_ADMIN, {});
  const attendance = catalog.modules.find((row) => row.moduleKey === "attendance");
  assert.ok(attendance);
  assert.deepEqual(attendance.actions, ["create", "read", "update", "delete"]);
  assert.deepEqual(attendance.dependencies.create, ["read"]);
});

test("GET configured expose locks dependency et overlay invariant", async () => {
  const { repo, rbac } = memoryRepo();
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
    moduleKey: "attendance",
    canCreate: true,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "superadmin",
  });
  const matrix = await getConfiguredPermissions(
    repo,
    { roleKey: "PREFET_ETUDES", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER_ADMIN,
  );
  const attendance = matrix.modules.find((row) => row.moduleKey === "attendance");
  assert.equal(attendance.locks.read.locked, true);
  assert.equal(attendance.locks.read.reason, LOCK_KIND.DEPENDENCY);
  assert.equal(attendance.locks.create.locked, false);
});

test("assertMandatoryPermissionPatch PREFET users.read=false autorisé", () => {
  assert.doesNotThrow(() =>
    assertMandatoryPermissionPatch("PREFET_ETUDES", [
      { moduleKey: "users", canCreate: false, canRead: false, canUpdate: false, canDelete: false },
    ]),
  );
});
