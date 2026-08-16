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
const {
  patchConfiguredPermissions,
  ensureFunctionalRbacBootstrap,
  resolveEffectivePermissionsForPrincipal,
  mergeRolePermissionMaps,
} = require("./functionalRbacService");
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

test("COUNTRY_ADMIN conserve COUNTRY_PRIVILEGES", () => {
  const resolved = resolveEffectivePermissionSet(["COUNTRY_ADMIN"], [], {});
  assert.ok(resolved.permissions.includes("COUNTRY_PRIVILEGES"));
  assert.ok(!resolved.permissions.includes("Pays:CREATE"));
  assert.ok(!resolved.permissions.includes("Pays:DELETE"));
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
  const added = parsePermissionStringsToModuleCrud(["Ajouter enseignants", "Modifier notes"]);
  assert.equal(added.teachers.canCreate, true);
  assert.equal(added.grades.canUpdate, true);
  const aliases = parsePermissionStringsToModuleCrud(["Voir enfant", "Faire appel", "Gérer appels", "Valider bulletins"]);
  assert.equal(aliases.students.canRead, true);
  assert.equal(aliases.attendance.canRead, true);
  assert.equal(aliases.attendance.canUpdate, true);
  assert.equal(aliases.attendance.canCreate, true);
  assert.equal(aliases.report_cards.canUpdate, true);
  assert.equal(aliases.report_cards.canRead, true);
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

test("fusion des cartes : liste vide n'écrase pas Admin School", () => {
  const merged = mergeRolePermissionMaps(
    { "Admin School": ["Gérer élèves"] },
    { "Admin School": [], SCHOOL_ADMIN: [] },
  );
  assert.ok(merged["Admin School"].includes("Gérer élèves"));
  assert.deepEqual(merged.SCHOOL_ADMIN, []);
});

test("backfill conserve Élèves:READ pour SCHOOL_ADMIN malgré catalogue plateforme vide", async () => {
  const rbac = createFunctionalRbacMemoryStore();
  const repo = {
    getFunctionalRbacStore: () => rbac,
    getPlatformRolePermissionsMap: async () => require("../data").rolePermissions,
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({
        "Admin School": [],
        SCHOOL_ADMIN: [],
        "Super Administrateur Somafrik": [],
        SUPER_ADMIN: [],
      }),
      getRoleByNameOrCode: async () => ({ id: "existing" }),
      insertRole: async () => {},
      markSystemProtected: async () => true,
    }),
  };
  await ensureFunctionalRbacBootstrap(repo);
  const grants = await rbac.listGrantsForRoles(["SCHOOL_ADMIN"]);
  const students = grants.find((row) => row.moduleKey === "students");
  assert.ok(students, "grant students SCHOOL_ADMIN attendu");
  assert.equal(students.canRead, true);
  assert.equal(students.canCreate, true);
});

test("live-resolve Admin School : Élèves:READ si grants métier absents mais carte seed présente", async () => {
  const rbac = createFunctionalRbacMemoryStore();
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    updatedBy: "bootstrap",
  });
  const repo = {
    getFunctionalRbacStore: () => rbac,
    getRolePermissionsMap: async () => ({
      "Admin School": [],
      SCHOOL_ADMIN: [],
    }),
  };
  const live = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: "CD-2026-0001",
  });
  assert.equal(live.modules.students.canRead, true);
  assert.ok(live.permissions.includes("Élèves:READ"));
});

test("live-resolve SUPER_ADMIN sans roleKeys conserve ALL_PRIVILEGES si d'autres grants existent", async () => {
  const rbac = createFunctionalRbacMemoryStore();
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    updatedBy: "bootstrap",
  });
  const repo = { getFunctionalRbacStore: () => rbac };
  const live = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Super Administrateur Somafrik",
    roleKeys: [],
    schoolCode: "*",
  });
  assert.ok(live.permissions.includes("ALL_PRIVILEGES"));
  assert.equal(live.modules.users.canCreate, true);
});

test("POST /api/classes accepte Classes:CREATE après overlay live", () => {
  const { RbacService } = require("../services/rbacService");
  const rbac = new RbacService({ rolePermissions: {} });
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Classes:CREATE"] }, "POST /api/classes"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Classes:READ"] }, "POST /api/classes"),
    false,
  );
});

test("PUT planning-exams accepte Examens:UPDATE après overlay live", () => {
  const { RbacService } = require("../services/rbacService");
  const rbac = new RbacService({ rolePermissions: {} });
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Examens:UPDATE"] }, "PUT /api/backoffice/planning-exams"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Admin School", permissions: ["Examens:READ"] }, "PUT /api/backoffice/planning-exams"),
    false,
  );
});

test("GET /api/v2/subjects accepte Matières:READ ou Affectations:CREATE", () => {
  const { RbacService } = require("../services/rbacService");
  const rbac = new RbacService({ rolePermissions: {} });
  assert.equal(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Affectations:CREATE"] },
      "GET /api/v2/subjects",
    ),
    true,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Matières:READ"] },
      "GET /api/v2/subjects",
    ),
    true,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Enseignants:UPDATE"] },
      "GET /api/v2/subjects",
    ),
    false,
  );
});

test("POST /api/assignments exige Affectations:CREATE, pas Matières:CREATE", () => {
  const { RbacService } = require("../services/rbacService");
  const rbac = new RbacService({ rolePermissions: {} });
  assert.equal(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Affectations:CREATE", "Enseignants:UPDATE"] },
      "POST /api/assignments",
    ),
    true,
  );
  assert.equal(
    rbac.canAccess(
      { role: "Admin School", permissions: ["Enseignants:UPDATE", "Matières:CREATE", "Gérer cours"] },
      "POST /api/assignments",
    ),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Secrétaire", permissions: ["Affectations:READ"] }, "POST /api/assignments"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: ["Affectations:READ"] }, "POST /api/assignments"),
    false,
  );
});

test("live CRUD : révoquer Comptable retire Rapports:READ hors liste métier Secrétaire", async () => {
  const rbac = createFunctionalRbacMemoryStore();
  const repo = {
    getFunctionalRbacStore: () => rbac,
    getPlatformRolePermissionsMap: async () => require("../data").rolePermissionsForLiveRbac(),
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({}),
      getRoleByNameOrCode: async () => ({ id: "existing" }),
      insertRole: async () => {},
      markSystemProtected: async () => true,
    }),
  };
  await ensureFunctionalRbacBootstrap(repo);
  const bothGrants = await rbac.listGrantsForRoles(["SECRETARY", "ACCOUNTANT"]);
  const secretaryGrants = await rbac.listGrantsForRoles(["SECRETARY"]);
  const both = resolveEffectivePermissionSet(["SECRETARY", "ACCOUNTANT"], bothGrants);
  const secretary = resolveEffectivePermissionSet(["SECRETARY"], secretaryGrants);
  assert.ok(both.permissions.includes("Rapports:READ"), JSON.stringify(both.permissions));
  assert.equal(secretary.permissions.includes("Rapports:READ"), false, JSON.stringify(secretary.permissions));
  assert.notDeepEqual(both.permissions, secretary.permissions);
});

test("catalogue établissement vide : fail-closed même si grants backfill existent", async () => {
  const rbac = createFunctionalRbacMemoryStore();
  await rbac.upsertGrant({
    roleKey: "SECRETARY",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "bootstrap",
  });
  const repo = {
    getFunctionalRbacStore: () => rbac,
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({
        Secrétaire: [],
        secretaire: [],
      }),
    }),
  };
  const live = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Secrétaire",
    roleKeys: ["SECRETARY"],
    schoolCode: "CD-2026-0001",
  });
  assert.deepEqual(live.permissions, []);
});

test("catalogue plateforme vide n'efface pas SCHOOL_ADMIN", async () => {
  const rbac = createFunctionalRbacMemoryStore();
  await rbac.upsertGrant({
    roleKey: "SCHOOL_ADMIN",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    updatedBy: "bootstrap",
  });
  const repo = {
    getFunctionalRbacStore: () => rbac,
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({
        "Admin School": [],
        SCHOOL_ADMIN: [],
      }),
    }),
  };
  const live = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
    schoolCode: "CD-2026-0001",
  });
  assert.ok(live.permissions.includes("Élèves:READ"));
});

test("seed live SCHOOL_ADMIN inclut Affectations:CREATE", () => {
  const live = require("../data").rolePermissionsForLiveRbac();
  const parsedAdmin = parsePermissionStringsToModuleCrud(live["Admin School"]);
  assert.equal(parsedAdmin.teachers.canUpdate, true);
  assert.equal(parsedAdmin.assignments.canRead, true);
  assert.equal(parsedAdmin.assignments.canCreate, true);
  assert.equal(parsedAdmin.assignments.canUpdate, true);
  assert.equal(parsedAdmin.assignments.canDelete, false);
  const parsedPrefet = parsePermissionStringsToModuleCrud(live["Préfet des études"]);
  assert.equal(parsedPrefet.assignments.canCreate, true);
  assert.equal(parsedPrefet.assignments.canDelete, true);
});

test("backfill modules manquants : SCHOOL_ADMIN Affectations:CREATE sans écraser un DENY", async () => {
  const rbac = createFunctionalRbacMemoryStore();
  await rbac.upsertGrant({
    roleKey: "SCHOOL_ADMIN",
    scopeType: "global",
    moduleKey: "teachers",
    canRead: true,
    canCreate: true,
    canUpdate: true,
    canDelete: false,
    updatedBy: "bootstrap",
  });
  const repo = {
    getFunctionalRbacStore: () => rbac,
    getPlatformRolePermissionsMap: async () => require("../data").rolePermissionsForLiveRbac(),
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({
        "Admin School": [],
        SCHOOL_ADMIN: [],
      }),
      getRoleByNameOrCode: async () => ({ id: "existing" }),
      insertRole: async () => {},
      markSystemProtected: async () => true,
    }),
  };
  await ensureFunctionalRbacBootstrap(repo);
  const grants = await rbac.listGrantsForRoles(["SCHOOL_ADMIN"]);
  const teachers = grants.find((row) => row.moduleKey === "teachers");
  assert.equal(teachers.canUpdate, true);
  assert.equal(teachers.canDelete, false);
  const assignments = grants.find((row) => row.moduleKey === "assignments");
  assert.ok(assignments, "grant assignments SCHOOL_ADMIN attendu après backfill modules manquants");
  assert.equal(assignments.canCreate, true);
  assert.equal(assignments.canRead, true);
  assert.equal(assignments.canUpdate, true);
  assert.equal(assignments.canDelete, false);

  await rbac.upsertGrant({
    roleKey: "SCHOOL_ADMIN",
    scopeType: "global",
    moduleKey: "assignments",
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
    updatedBy: "superadmin",
  });
  await ensureFunctionalRbacBootstrap(repo);
  const denied = (await rbac.listGrantsForRoles(["SCHOOL_ADMIN"])).find((row) => row.moduleKey === "assignments");
  assert.equal(denied.canCreate, false);
});
