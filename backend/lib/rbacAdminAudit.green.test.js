"use strict";

/**
 * AUDIT RBAC Administration — tests VERTS de sécurité.
 * Fail-closed, isolation, protection des rôles système, SCHOOL_ADMIN sans écriture globale.
 * Doivent rester verts. Aucun élargissement de privilèges.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { routePermissions } = require("../services/rbacService");
const {
  FUNCTIONAL_RBAC_ERROR,
  PROTECTED_SYSTEM_ROLE_KEYS,
  SUPER_ADMIN_INVARIANT_MODULES,
  assertNotProtectedArchive,
} = require("./functionalRbacManagement");
const { assertMandatoryPermissionPatch, MODULE_ACTION_DEPENDENCIES } = require("./rbacMandatoryPermissions");
const { resolveEffectivePermissionSet } = require("./functionalRbacResolution");
const {
  SUPER_ADMIN,
  COUNTRY_ADMIN,
  SCHOOL_ADMIN,
  SCHOOL_CD_A,
  SCHOOL_CD_B,
  SCHOOL_BI,
  COUNTRY_CD,
  COUNTRY_BI,
  BUSINESS_ROLES,
  createAuditRepo,
  seedGlobalStudentsGrants,
  moduleFlags,
  loadSchoolPath,
  patchConfiguredPermissions,
  getConfiguredPermissions,
  listRbacCatalog,
} = require("./rbacAdminAudit.fixtures");

test("RED-05 VERT — invariant SUPER_ADMIN users/role_permissions refusé ; archive rôles système refusée", async () => {
  const { repo } = createAuditRepo();
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
      error.details?.lockKind === "role_invariant",
  );
  await assert.rejects(
    () =>
      patchConfiguredPermissions(
        repo,
        {
          roleKey: "SUPER_ADMIN",
          countryCode: "CD",
          schoolCode: "CD-2026-0001",
          grants: [
            {
              moduleKey: "role_permissions",
              canCreate: false,
              canRead: false,
              canUpdate: false,
              canDelete: false,
            },
          ],
        },
        SUPER_ADMIN,
        {},
      ),
    (error) => error.code === FUNCTIONAL_RBAC_ERROR.MANDATORY_PERMISSION,
  );

  for (const roleKey of PROTECTED_SYSTEM_ROLE_KEYS) {
    assert.throws(
      () => assertNotProtectedArchive(roleKey),
      (error) => error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
    );
  }
  assert.deepEqual([...PROTECTED_SYSTEM_ROLE_KEYS].sort(), ["COUNTRY_ADMIN", "SCHOOL_ADMIN", "SUPER_ADMIN"]);
  assert.equal(SUPER_ADMIN_INVARIANT_MODULES.users.canDelete, true);
  assert.equal(SUPER_ADMIN_INVARIANT_MODULES.countries.canDelete, false);
});

test("RED-06 VERT — fail-closed : module inconnu, rôle vide, contexte établissement invalide, permission absente", async () => {
  const { repo } = createAuditRepo();
  await assert.rejects(
    () =>
      patchConfiguredPermissions(
        repo,
        {
          roleKey: "PRINCIPAL",
          countryCode: "CD",
          schoolCode: "CD-2026-0001",
          grants: [{ moduleKey: "bibliotheque_mvp", canCreate: true, canRead: true, canUpdate: false, canDelete: false }],
        },
        SUPER_ADMIN,
        {},
      ),
    (error) => error.statusCode === 400 && error.code === FUNCTIONAL_RBAC_ERROR.INVALID_MODULE,
  );
  await assert.rejects(
    () =>
      patchConfiguredPermissions(
        repo,
        { countryCode: "CD", schoolCode: "CD-2026-0001", grants: [{ moduleKey: "students", canRead: true }] },
        SUPER_ADMIN,
        {},
      ),
    (error) => error.statusCode === 400 && error.code === FUNCTIONAL_RBAC_ERROR.INVALID_ROLE,
  );
  await assert.rejects(
    () =>
      getConfiguredPermissions(
        repo,
        { roleKey: "PRINCIPAL", countryCode: "CD", schoolCode: "ZZ-INEXISTANT" },
        SUPER_ADMIN,
      ),
    (error) => error.statusCode === 400 && error.code === FUNCTIONAL_RBAC_ERROR.INVALID_SCOPE,
  );

  const unknown = resolveEffectivePermissionSet(["ROLE_INCONNU"], [], {
    schoolId: SCHOOL_CD_A.id,
    countryId: COUNTRY_CD.id,
  });
  assert.equal(unknown.modules.students.canRead, false);
  assert.deepEqual(unknown.permissions, []);
});

test("RED-07 VERT — isolation établissement : patch école A n'autorise pas école B", async () => {
  const { repo, rbac } = createAuditRepo();
  await seedGlobalStudentsGrants(rbac, ["PRINCIPAL"]);
  const beforeB = await loadSchoolPath(repo, "PRINCIPAL", {
    countryCode: "CD",
    schoolCode: "CD-2026-0002",
  });

  await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PRINCIPAL",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: true, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER_ADMIN,
    {},
  );

  const afterA = await loadSchoolPath(repo, "PRINCIPAL", {
    countryCode: "CD",
    schoolCode: "CD-2026-0001",
  });
  const afterB = await loadSchoolPath(repo, "PRINCIPAL", {
    countryCode: "CD",
    schoolCode: "CD-2026-0002",
  });
  assert.equal(moduleFlags(afterA.effective, "students").canCreate, true);
  assert.equal(moduleFlags(afterB.effective, "students").canCreate, moduleFlags(beforeB.effective, "students").canCreate);
  assert.equal(moduleFlags(afterB.configured, "students").configured, false);

  const grants = await rbac.listGrantsForRoles(["PRINCIPAL"]);
  const resolvedB = resolveEffectivePermissionSet(["PRINCIPAL"], grants, {
    schoolId: SCHOOL_CD_B.id,
    countryId: COUNTRY_CD.id,
  });
  assert.equal(resolvedB.modules.students.canCreate, false);
});

test("RED-08 VERT — isolation pays : une config CD n'autorise pas implicitement BI", async () => {
  const { repo, rbac } = createAuditRepo();
  await rbac.upsertGrant({
    roleKey: "SECRETARY",
    scopeType: "country",
    countryId: COUNTRY_CD.id,
    schoolId: null,
    moduleKey: "students",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    updatedBy: "audit",
  });

  const grants = await rbac.listGrantsForRoles(["SECRETARY"]);
  const inCd = resolveEffectivePermissionSet(["SECRETARY"], grants, {
    schoolId: SCHOOL_CD_A.id,
    countryId: COUNTRY_CD.id,
  });
  const inBi = resolveEffectivePermissionSet(["SECRETARY"], grants, {
    schoolId: SCHOOL_BI.id,
    countryId: COUNTRY_BI.id,
  });
  assert.equal(inCd.modules.students.canCreate, true);
  assert.equal(inBi.modules.students.canCreate, false);
  assert.equal(inBi.modules.students.canRead, false);
  assert.ok(!inBi.permissions.includes("Élèves:CREATE"));
});

test("RED-09 VERT — SCHOOL_ADMIN / COUNTRY_ADMIN ne peuvent pas écrire la matrice ni lister le catalogue", async () => {
  const { repo, rbac } = createAuditRepo();
  await seedGlobalStudentsGrants(rbac, ["PRINCIPAL"]);
  const payload = {
    roleKey: "PRINCIPAL",
    countryCode: "CD",
    schoolCode: "CD-2026-0001",
    grants: [{ moduleKey: "students", canCreate: true, canRead: true, canUpdate: true, canDelete: true }],
  };

  await assert.rejects(
    () => patchConfiguredPermissions(repo, payload, SCHOOL_ADMIN, {}),
    (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.FORBIDDEN,
  );
  await assert.rejects(
    () => patchConfiguredPermissions(repo, payload, COUNTRY_ADMIN, {}),
    (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.FORBIDDEN,
  );
  await assert.rejects(
    () => listRbacCatalog(repo, SCHOOL_ADMIN),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => getConfiguredPermissions(repo, { roleKey: "PRINCIPAL", schoolCode: "CD-2026-0001" }, SCHOOL_ADMIN),
    (error) => error.statusCode === 403,
  );

  assert.deepEqual(routePermissions["PATCH /api/backoffice/rbac/permissions"], ["ALL_PRIVILEGES"]);
  assert.deepEqual(routePermissions["GET /api/backoffice/rbac/permissions"], ["ALL_PRIVILEGES"]);
  assert.deepEqual(routePermissions["GET /api/backoffice/rbac/catalog"], ["ALL_PRIVILEGES"]);
});

test("RED-10 VERT — dépendance CREATE/UPDATE/DELETE → READ : UI helper + backend, pas seulement l'écran", async () => {
  assert.deepEqual(MODULE_ACTION_DEPENDENCIES.create, ["read"]);
  assert.deepEqual(MODULE_ACTION_DEPENDENCIES.update, ["read"]);
  assert.deepEqual(MODULE_ACTION_DEPENDENCIES.delete, ["read"]);

  assert.throws(
    () =>
      assertMandatoryPermissionPatch("PRINCIPAL", [
        { moduleKey: "students", canCreate: true, canRead: false, canUpdate: false, canDelete: false },
      ]),
    (error) => error.code === FUNCTIONAL_RBAC_ERROR.MANDATORY_PERMISSION && error.details?.lockKind === "dependency",
  );
  assert.throws(
    () =>
      assertMandatoryPermissionPatch("TEACHER", [
        { moduleKey: "students", canCreate: false, canRead: false, canUpdate: true, canDelete: true },
      ]),
    (error) => error.details?.lockKind === "dependency" && error.details?.action === "read",
  );
  assert.doesNotThrow(() =>
    assertMandatoryPermissionPatch("SECRETARY", [
      { moduleKey: "students", canCreate: false, canRead: true, canUpdate: true, canDelete: false },
    ]),
  );

  const { repo } = createAuditRepo();
  await assert.rejects(
    () =>
      patchConfiguredPermissions(
        repo,
        {
          roleKey: "PRINCIPAL",
          countryCode: "CD",
          schoolCode: "CD-2026-0001",
          grants: [{ moduleKey: "students", canCreate: false, canRead: false, canUpdate: true, canDelete: false }],
        },
        SUPER_ADMIN,
        {},
      ),
    (error) => error.statusCode === 409 && error.code === FUNCTIONAL_RBAC_ERROR.MANDATORY_PERMISSION,
  );
});

test("VERT — PUT legacy role-permissions reste fermé ; PATCH métier Superadmin existe encore", async () => {
  const { throwLegacyRolePermissionsWrite } = require("./functionalRbacService");
  assert.throws(
    () => throwLegacyRolePermissionsWrite(),
    (error) =>
      error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.LEGACY_ROLE_PERMISSIONS_WRITE_FORBIDDEN,
  );
  assert.deepEqual(routePermissions["PUT /api/backoffice/role-permissions"], ["ALL_PRIVILEGES"]);

  const { repo } = createAuditRepo();
  const saved = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PRINCIPAL",
      countryCode: "CD",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: false, canRead: true, canUpdate: false, canDelete: false }],
    },
    SUPER_ADMIN,
    {},
  );
  assert.ok(saved.updatedAt);
  assert.equal(saved.roleKey, "PRINCIPAL");
  assert.equal(saved.scopeType, "school");
});

test("VERT — rôles métier du référentiel réel (pas de tables inventées)", () => {
  const keys = BUSINESS_ROLES.map((role) => role.roleKey);
  assert.ok(keys.includes("PRINCIPAL"));
  assert.ok(keys.includes("SECRETARY"));
  assert.ok(keys.includes("TEACHER"));
  assert.ok(keys.includes("ACCOUNTANT"));
  assert.equal(
    BUSINESS_ROLES.find((role) => role.roleKey === "PRINCIPAL").roleName,
    "Directeur",
  );
});
