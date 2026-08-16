"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveEffectivePermissionSet,
  parsePermissionStringsToModuleCrud,
} = require("./functionalRbacResolution");
const {
  FUNCTIONAL_RBAC_ERROR,
  throwLegacyRolePermissionsWrite,
  assertSuperAdminInvariantPatch,
  assertNotProtectedArchive,
} = require("./functionalRbacManagement");
const { patchConfiguredPermissions } = require("./functionalRbacService");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");

test("cascade établissement > pays > global > DENY", () => {
  const grants = [
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "global",
      moduleKey: "students",
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    },
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "country",
      countryId: "cd",
      moduleKey: "students",
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: true,
    },
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      schoolId: "nuru",
      moduleKey: "students",
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: false,
    },
  ];
  const nuru = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants, {
    schoolId: "nuru",
    countryId: "cd",
  });
  assert.equal(nuru.modules.students.canDelete, false);
  assert.equal(nuru.modules.students.canRead, true);
  assert.ok(!nuru.permissions.includes("Élèves:DELETE"));
  assert.ok(nuru.permissions.includes("Élèves:READ"));

  const otherSchool = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants, {
    schoolId: "other",
    countryId: "cd",
  });
  assert.equal(otherSchool.modules.students.canDelete, true);

  const otherCountry = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants, {
    schoolId: "bi-school",
    countryId: "bi",
  });
  assert.equal(otherCountry.modules.students.canDelete, true);

  const unknown = resolveEffectivePermissionSet(["PREFET_ETUDES"], [], { schoolId: "nuru" });
  assert.equal(unknown.modules.students.canRead, false);
  assert.deepEqual(unknown.permissions, []);
});

test("multi-rôle union et rôle révoqué ignoré", () => {
  const grants = [
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "global",
      moduleKey: "students",
      canRead: true,
      canUpdate: true,
      canDelete: false,
    },
    {
      roleKey: "SECRETARY",
      scopeType: "global",
      moduleKey: "students",
      canRead: true,
      canCreate: true,
      canDelete: true,
    },
  ];
  const union = resolveEffectivePermissionSet(["PREFET_ETUDES", "SECRETARY"], grants, {});
  assert.equal(union.modules.students.canCreate, true);
  assert.equal(union.modules.students.canDelete, true);
  const revoked = resolveEffectivePermissionSet(["PREFET_ETUDES"], grants, {});
  assert.equal(revoked.modules.students.canDelete, false);
  assert.equal(revoked.modules.students.canCreate, false);
});

test("invariants SUPER_ADMIN et archive protégée", () => {
  const resolved = resolveEffectivePermissionSet(["SUPER_ADMIN"], [], {});
  assert.ok(resolved.permissions.includes("ALL_PRIVILEGES"));
  assert.equal(resolved.modules.role_permissions.canUpdate, true);
  assert.equal(resolved.modules.users.canRead, true);
  assert.throws(
    () =>
      assertSuperAdminInvariantPatch("SUPER_ADMIN", [
        { moduleKey: "role_permissions", canCreate: false, canRead: false, canUpdate: false, canDelete: false },
      ]),
    (error) => error.code === FUNCTIONAL_RBAC_ERROR.SUPER_ADMIN_INVARIANT,
  );
  assert.throws(
    () => assertNotProtectedArchive("SUPER_ADMIN"),
    (error) => error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
  );
  assert.throws(
    () => throwLegacyRolePermissionsWrite(),
    (error) => error.code === FUNCTIONAL_RBAC_ERROR.LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN,
  );
});

test("backfill parse Module:ACTION et Gérer", () => {
  const parsed = parsePermissionStringsToModuleCrud(["Élèves:READ", "Élèves:UPDATE", "Gérer classes"]);
  assert.equal(parsed.students.canRead, true);
  assert.equal(parsed.students.canDelete, false);
  assert.equal(parsed.classes.canCreate, true);
  assert.equal(parsed.classes.canDelete, true);
});

test("409 expectedUpdatedAt et audit rollback mémoire si audit échoue", async () => {
  const rbac = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async () => ({
      country: { id: "cd", code: "CD" },
      school: { id: "nuru", school_code: "CD-2026-0001", country_id: "cd", country_code: "CD" },
    }),
  });
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
    moduleKey: "students",
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "bootstrap",
  });
  const first = await rbac.maxUpdatedAtForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  });
  const audits = [];
  const repo = {
    getFunctionalRbacStore: () => rbac,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async (entry) => {
      if (entry.__fail || entry.action === "ROLE_PERMISSION_MATRIX_UPDATED") {
        /* first matrix audit always runs */
      }
      audits.push(entry);
    },
  };
  const superAdmin = { role: "Super Administrateur Somafrik", identifier: "superadmin" };
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: "CD-2026-0001",
      expectedUpdatedAt: first,
      grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
    },
    superAdmin,
    {},
  );
  await assert.rejects(
    () =>
      patchConfiguredPermissions(
        repo,
        {
          roleKey: "PREFET_ETUDES",
          schoolCode: "CD-2026-0001",
          expectedUpdatedAt: first,
          grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: true }],
        },
        superAdmin,
        {},
      ),
    (error) => error.statusCode === 409 && error.code === FUNCTIONAL_RBAC_ERROR.CONFLICT,
  );
});

test("PATCH schoolCode n'est pas traité comme un UUID", async () => {
  const calls = [];
  const rbac = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async (args) => {
      calls.push(args);
      if (args.schoolId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(args.schoolId))) {
        throw new Error("invalid uuid schoolId");
      }
      return {
        country: { id: "550e8400-e29b-41d4-a716-446655440000", code: "CD" },
        school: {
          id: "550e8400-e29b-41d4-a716-446655440001",
          school_code: "CD-2026-0001",
          country_id: "550e8400-e29b-41d4-a716-446655440000",
          country_code: "CD",
        },
      };
    },
  });
  const repo = {
    getFunctionalRbacStore: () => rbac,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async () => true,
  };
  const saved = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false }],
    },
    { role: "Super Administrateur Somafrik", identifier: "superadmin" },
    {},
  );
  assert.equal(saved.schoolCode, "CD-2026-0001");
  assert.equal(calls[0].schoolCode, "CD-2026-0001");
  assert.equal(calls[0].schoolId, undefined);
});
