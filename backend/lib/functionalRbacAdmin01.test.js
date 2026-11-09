"use strict";

/**
 * ADMIN-01 — console Superadmin Rôles et droits.
 * Hydratation effective, pas de DENY fantôme, reset d'override.
 * Ne touche pas pickGrant / SCHOOL_ADMIN / PUT legacy / Relations / Documents.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  getConfiguredPermissions,
  getEffectivePermissionsConfigured,
  patchConfiguredPermissions,
  resetConfiguredPermissionOverrides,
} = require("./functionalRbacService");
const { pickGrant, indexGrants } = require("./functionalRbacResolution");
const { FUNCTIONAL_RBAC_ERROR } = require("./functionalRbacManagement");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { routePermissions } = require("../services/rbacService");
const { PLATFORM_ADMIN_ALLOWED, SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM } = require("./platformPersonalDataGuard");

const SUPER_ADMIN = { role: "Super Administrateur Somafrik", identifier: "superadmin", roleKeys: ["SUPER_ADMIN"] };
const SCHOOL_ADMIN = { role: "Admin School", identifier: "school-admin", roleKeys: ["SCHOOL_ADMIN"] };

function memoryRepo() {
  const rbac = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async ({ schoolCode, countryCode }) => {
      if (schoolCode === "CD-2026-0002") {
        return {
          country: { id: "cd", code: "CD" },
          school: { id: "lumiere", school_code: "CD-2026-0002", country_id: "cd", country_code: "CD" },
        };
      }
      if (countryCode === "BI" && !schoolCode) {
        return { country: { id: "bi", code: "BI" }, school: null };
      }
      return {
        country: { id: "cd", code: "CD" },
        school: { id: "nuru", school_code: "CD-2026-0001", country_id: "cd", country_code: "CD" },
      };
    },
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

async function seedGlobalStudents(rbac, flags = { canCreate: false, canRead: true, canUpdate: true, canDelete: true }) {
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: "students",
    ...flags,
    updatedBy: "bootstrap",
  });
}

test("ADMIN-01 GET configured école hydrate l'effectif global (pas une matrice vide)", async () => {
  const { repo, rbac } = memoryRepo();
  await seedGlobalStudents(rbac);
  const matrix = await getConfiguredPermissions(
    repo,
    { roleKey: "PREFET_ETUDES", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER_ADMIN,
  );
  const students = matrix.modules.find((row) => row.moduleKey === "students");
  assert.equal(students.canCreate, false);
  assert.equal(students.canRead, true);
  assert.equal(students.canUpdate, true);
  assert.equal(students.canDelete, true);
  assert.equal(students.configured, false);
  assert.equal(students.source, "global");
  assert.equal(students.inherited, true);
  assert.equal(students.locks.read.locked, true);
  assert.equal(students.locks.read.reason, "dependency");
});

test("ADMIN-01 PATCH inchangé depuis l'effectif n'écrit pas de DENY école", async () => {
  const { repo, rbac } = memoryRepo();
  await seedGlobalStudents(rbac);
  const saved = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: true }],
    },
    SUPER_ADMIN,
    {},
  );
  assert.equal(saved.grants[0].skipped, true);
  const schoolRows = await rbac.listGrantsForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  });
  assert.equal(schoolRows.find((row) => row.moduleKey === "students"), undefined);
  const effective = await getEffectivePermissionsConfigured(
    repo,
    { roleKey: "PREFET_ETUDES", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER_ADMIN,
  );
  assert.equal(effective.modules.find((row) => row.moduleKey === "students").canDelete, true);
});

test("ADMIN-01 PATCH CREATE reprend les 4 flags effectifs (pas de perte U/D)", async () => {
  const { repo, rbac } = memoryRepo();
  await seedGlobalStudents(rbac);
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: true, canRead: true, canUpdate: true, canDelete: true }],
    },
    SUPER_ADMIN,
    {},
  );
  const schoolRow = (await rbac.listGrantsForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  })).find((row) => row.moduleKey === "students");
  assert.equal(schoolRow.canCreate, true);
  assert.equal(schoolRow.canRead, true);
  assert.equal(schoolRow.canUpdate, true);
  assert.equal(schoolRow.canDelete, true);
  const reread = await getConfiguredPermissions(
    repo,
    { roleKey: "PREFET_ETUDES", countryCode: "CD", schoolCode: "CD-2026-0001" },
    SUPER_ADMIN,
  );
  const students = reread.modules.find((row) => row.moduleKey === "students");
  assert.equal(students.source, "school");
  assert.equal(students.configured, true);
  assert.equal(students.canUpdate, true);
  assert.equal(students.canDelete, true);
});

test("ADMIN-01 DENY école reste possible s'il est explicite (différent de l'héritage)", async () => {
  const { repo, rbac } = memoryRepo();
  await seedGlobalStudents(rbac);
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: false, canRead: false, canUpdate: false, canDelete: false }],
    },
    SUPER_ADMIN,
    {},
  );
  const schoolRow = (await rbac.listGrantsForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  })).find((row) => row.moduleKey === "students");
  assert.ok(schoolRow);
  assert.equal(schoolRow.canRead, false);
  assert.equal(schoolRow.canDelete, false);
});

test("ADMIN-01 reset archive l'override école et restaure l'héritage", async () => {
  const { repo, rbac } = memoryRepo();
  await seedGlobalStudents(rbac);
  const created = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER_ADMIN,
    {},
  );
  const reset = await resetConfiguredPermissionOverrides(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      moduleKey: "students",
      expectedUpdatedAt: created.updatedAt,
    },
    SUPER_ADMIN,
    {},
  );
  const students = reset.modules.find((row) => row.moduleKey === "students");
  assert.equal(students.source, "global");
  assert.equal(students.configured, false);
  assert.equal(students.canUpdate, true);
  assert.equal(students.canDelete, true);
  const schoolRows = await rbac.listGrantsForScope({
    roleKey: "PREFET_ETUDES",
    scopeType: "school",
    countryId: "cd",
    schoolId: "nuru",
  });
  assert.equal(schoolRows.find((row) => row.moduleKey === "students"), undefined);
});

test("ADMIN-01 reset SCHOOL_ADMIN est refusé ; isolation école A ≠ B", async () => {
  const { repo, rbac } = memoryRepo();
  await seedGlobalStudents(rbac);
  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER_ADMIN,
    {},
  );
  await assert.rejects(
    () =>
      resetConfiguredPermissionOverrides(
        repo,
        {
          roleKey: "PREFET_ETUDES",
          countryCode: "CD",
          schoolCode: "CD-2026-0001",
          moduleKey: "students",
        },
        SCHOOL_ADMIN,
        {},
      ),
    (error) => error.statusCode === 403,
  );
  const other = await getConfiguredPermissions(
    repo,
    { roleKey: "PREFET_ETUDES", countryCode: "CD", schoolCode: "CD-2026-0002" },
    SUPER_ADMIN,
  );
  const students = other.modules.find((row) => row.moduleKey === "students");
  assert.equal(students.source, "global");
  assert.equal(students.canDelete, true);
});

test("ADMIN-01 pickGrant first-match inchangé ; reset/PATCH Superadmin only dans le catalogue", () => {
  const grants = [
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "global",
      moduleKey: "students",
      canRead: true,
      canUpdate: true,
      canDelete: true,
    },
    {
      roleKey: "PREFET_ETUDES",
      scopeType: "school",
      schoolId: "nuru",
      moduleKey: "students",
      canRead: true,
      canUpdate: false,
      canDelete: false,
    },
  ];
  const picked = pickGrant(indexGrants(grants), "PREFET_ETUDES", "students", {
    schoolId: "nuru",
    countryId: "cd",
  });
  assert.equal(picked.canDelete, false);
  assert.deepEqual(routePermissions["POST /api/backoffice/rbac/permissions/reset"], ["ALL_PRIVILEGES"]);
  assert.equal(PLATFORM_ADMIN_ALLOWED.includes("POST /api/backoffice/rbac/permissions/reset"), true);
  assert.equal(
    SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("POST /api/backoffice/rbac/permissions/reset"),
    false,
  );
  assert.equal(FUNCTIONAL_RBAC_ERROR.LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN, "LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN");
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/backoffice/relations"), true);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes("GET /api/school-documents"), true);
});
