"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { buildSeedRolesFromData } = require("./establishmentRolesService");
const { reconcileCanonicalSystemRoles } = require("./systemRolesReconciliation");
const { SYSTEM_ROLES_RECONCILIATION_ERROR } = require("./canonicalSystemRoles");
const { RbacService, routePermissions } = require("../services/rbacService");
const { resolveEffectivePermissionsForPrincipal } = require("./functionalRbacService");
const { toRoleKey } = require("./userRoleLifecycle");

const PRODUCTION_TEACHER_ALIASES = [
  "Voir élèves",
  "Modifier notes",
  "Créer notes",
  "Faire appel",
  "Messages parents",
  "Voir examens",
  "Voir bulletins",
  "Voir documents",
  "Planning de cours:READ",
  "Salles:READ",
  "Remplacements:READ",
];

const SYSTEM_ROLE_KEYS = [
  "TEACHER", "PREFET_ETUDES", "PRINCIPAL", "PROVISEUR", "SECRETARY",
  "PARENT", "STUDENT", "ACCOUNTANT", "SUPERVISOR",
  "SUPER_ADMIN", "COUNTRY_ADMIN", "SCHOOL_ADMIN",
];

function createMemoryRepo(seedRoles = []) {
  let rolesStore = createEstablishmentRolesMemoryStore({ roles: seedRoles });
  let rbacStore = createFunctionalRbacMemoryStore();
  const repo = {
    getEstablishmentRolesStore: () => rolesStore,
    getFunctionalRbacStore: () => rbacStore,
    createTxScope() {
      return repo;
    },
    async withTransaction(fn) {
      const snapshotRoles = JSON.parse(JSON.stringify(await rolesStore.listRoles({ includeArchived: true })));
      const snapshotGrants = JSON.parse(JSON.stringify(await rbacStore.listGrantsForRoles(SYSTEM_ROLE_KEYS)));
      try {
        return await fn({});
      } catch (error) {
        rolesStore = createEstablishmentRolesMemoryStore({ roles: snapshotRoles });
        rbacStore = createFunctionalRbacMemoryStore();
        for (const grant of snapshotGrants) {
          await rbacStore.upsertGrant({
            roleKey: grant.roleKey,
            scopeType: grant.scopeType || "global",
            countryId: grant.countryId ?? null,
            schoolId: grant.schoolId ?? null,
            moduleKey: grant.moduleKey,
            canCreate: grant.canCreate,
            canRead: grant.canRead,
            canUpdate: grant.canUpdate,
            canDelete: grant.canDelete,
            updatedBy: "rollback-restore",
          });
        }
        throw error;
      }
    },
  };
  return {
    repo,
    get rolesStore() {
      return rolesStore;
    },
    get rbacStore() {
      return rbacStore;
    },
  };
}

test("buildSeedRolesFromData utilise la matrice canonique, pas la liste déclarée", () => {
  const seed = buildSeedRolesFromData();
  const teacher = seed.find((role) => role.roleName === "Enseignant");
  assert.ok(teacher);
  assert.ok(teacher.permissions.includes("Voir élèves"));
  assert.ok(teacher.permissions.includes("Élèves:READ"));
  assert.ok(teacher.permissions.includes("Messages:READ"));
  assert.ok(teacher.permissions.includes("Notes:READ"));
  assert.equal(teacher.permissions.includes("Utilisateurs:READ"), false);
  assert.equal(teacher.permissions.includes("ALL_PRIVILEGES"), false);
});

test("base vide : réconciliation crée les rôles système sans doublon", async () => {
  const { repo, rolesStore } = createMemoryRepo();
  const first = await reconcileCanonicalSystemRoles(repo);
  assert.ok(first.createdRoles.length >= 9);
  const second = await reconcileCanonicalSystemRoles(repo);
  assert.equal(second.createdRoles.length, 0);
  const roles = await rolesStore.listRoles({ includeArchived: true });
  const teachers = roles.filter((role) => toRoleKey(role.roleName) === "TEACHER");
  assert.equal(teachers.length, 1);
});

test("base partielle production enseignant : GET students/messages refusés puis autorisés", async () => {
  const { repo, rbacStore } = createMemoryRepo([
    {
      roleCode: "enseignant",
      roleName: "Enseignant",
      permissions: PRODUCTION_TEACHER_ALIASES,
      delegationPermissions: PRODUCTION_TEACHER_ALIASES,
    },
  ]);
  await rbacStore.upsertGrant({
    roleKey: "TEACHER",
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: "students",
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "seed-prod",
  });
  await rbacStore.upsertGrant({
    roleKey: "TEACHER",
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: "grades",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: false,
    updatedBy: "seed-prod",
  });

  const before = await resolveEffectivePermissionsForPrincipal(repo, { role: "Enseignant", roleKeys: ["TEACHER"] });
  const rbac = new RbacService();
  assert.equal(before.permissions.includes("Messages:READ"), false);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: before.permissions }, "GET /api/backoffice/messages"), false);

  await reconcileCanonicalSystemRoles(repo);
  const after = await resolveEffectivePermissionsForPrincipal(repo, { role: "Enseignant", roleKeys: ["TEACHER"] });
  assert.ok(after.permissions.includes("Élèves:READ"));
  assert.ok(after.permissions.includes("Messages:READ"));
  assert.ok(after.permissions.includes("Notes:READ"));
  assert.ok(after.permissions.includes("Présences:READ"));
  assert.ok(after.permissions.includes("Classes:READ"));
  assert.equal(after.permissions.includes("Utilisateurs:UPDATE"), false);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: after.permissions }, "GET /api/students"), true);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: after.permissions }, "GET /api/backoffice/messages"), true);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: after.permissions }, "GET /api/notes"), true);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: after.permissions }, "POST /api/users/:id/reset-password"), false);
});

test("permission personnalisée et rôle personnalisé / archivé conservés", async () => {
  const { repo, rolesStore } = createMemoryRepo([
    {
      roleCode: "enseignant",
      roleName: "Enseignant",
      permissions: ["Voir élèves", "Permission locale atelier"],
      delegationPermissions: ["Voir élèves"],
    },
    {
      roleCode: "coach_custom",
      roleName: "Coach sportif",
      permissions: ["Droit custom coach"],
      delegationPermissions: ["Droit custom coach"],
    },
    {
      roleCode: "archived_custom",
      roleName: "Ancien rôle",
      status: "archived",
      permissions: ["Droit archivé"],
      delegationPermissions: [],
    },
  ]);
  await reconcileCanonicalSystemRoles(repo);
  const teacher = await rolesStore.getRoleByNameOrCode("Enseignant");
  assert.ok(teacher.permissions.includes("Permission locale atelier"));
  assert.ok(teacher.permissions.includes("Élèves:READ"));
  const custom = await rolesStore.getRoleByNameOrCode("Coach sportif");
  assert.deepEqual(custom.permissions, ["Droit custom coach"]);
  const archived = await rolesStore.getRoleByNameOrCode("Ancien rôle");
  assert.equal(archived.status, "archived");
  assert.deepEqual(archived.permissions, ["Droit archivé"]);
});

test("rôle système incomplet : délégations réconciliées, double exécution idempotente", async () => {
  const { repo, rolesStore } = createMemoryRepo([
    {
      roleCode: "prefet_des_etudes",
      roleName: "Préfet des études",
      permissions: ["Voir élèves"],
      delegationPermissions: ["Voir élèves"],
    },
  ]);
  const first = await reconcileCanonicalSystemRoles(repo);
  assert.ok(first.addedPermissions.some((row) => row.roleKey === "PREFET_ETUDES"));
  assert.ok(first.addedDelegations.some((row) => row.roleKey === "PREFET_ETUDES"));
  const second = await reconcileCanonicalSystemRoles(repo);
  assert.equal(second.addedPermissions.length, 0);
  assert.equal(second.addedDelegations.length, 0);
  assert.equal(second.createdRoles.length, 0);
  const prefet = await rolesStore.getRoleByNameOrCode("Préfet des études");
  const unique = new Set(prefet.permissions);
  assert.equal(unique.size, prefet.permissions.length);
  assert.ok(prefet.permissions.includes("Élèves:READ"));
  assert.ok(prefet.delegationPermissions.includes("Élèves:READ"));
});

test("ambiguïté : deux lignes pour le même rôle système → échec intégral", async () => {
  const { repo } = createMemoryRepo([
    { roleCode: "TEACHER", roleName: "Enseignant", permissions: ["Voir élèves"] },
    { roleCode: "enseignant", roleName: "Enseignant bis", permissions: ["Voir élèves"] },
  ]);
  await assert.rejects(
    () => reconcileCanonicalSystemRoles(repo),
    (error) => error.code === SYSTEM_ROLES_RECONCILIATION_ERROR,
  );
});

test("rôles métier concernés : jetons canoniques présents après réconciliation", async () => {
  const { repo } = createMemoryRepo();
  await reconcileCanonicalSystemRoles(repo);
  const rbac = new RbacService();
  const cases = [
    ["Préfet des études", "PREFET_ETUDES", "GET /api/students"],
    ["Directeur", "PRINCIPAL", "GET /api/students"],
    ["Proviseur", "PROVISEUR", "GET /api/students"],
    ["Secrétaire", "SECRETARY", "GET /api/students"],
    ["Parent", "PARENT", "GET /api/backoffice/messages"],
    ["Élève / Étudiant", "STUDENT", "GET /api/notes"],
    ["Comptable", "ACCOUNTANT", "GET /api/payments"],
  ];
  for (const [role, roleKey, route] of cases) {
    const live = await resolveEffectivePermissionsForPrincipal(repo, { role, roleKeys: [roleKey] });
    assert.equal(rbac.canAccess({ role, permissions: live.permissions }, route), true, `${role} ${route}`);
  }
});

test("révocation Superadmin Notes:CREATE enseignant n'est pas réintroduite", async () => {
  const { repo, rbacStore } = createMemoryRepo([
    {
      roleCode: "enseignant",
      roleName: "Enseignant",
      permissions: PRODUCTION_TEACHER_ALIASES,
      delegationPermissions: PRODUCTION_TEACHER_ALIASES,
    },
  ]);
  await rbacStore.upsertGrant({
    roleKey: "TEACHER",
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: "grades",
    canCreate: false,
    canRead: true,
    canUpdate: false,
    canDelete: false,
    updatedBy: "superadmin-revoke",
  });
  await reconcileCanonicalSystemRoles(repo);
  const grades = (await rbacStore.listGrantsForScope({
    roleKey: "TEACHER",
    scopeType: "global",
    countryId: null,
    schoolId: null,
  })).find((row) => row.moduleKey === "grades");
  assert.equal(grades.canCreate, false);
  assert.equal(grades.canUpdate, false);
  assert.equal(grades.canRead, true);
});

test("non-régression scopes : aucun jeton enseignant n'ouvre Utilisateurs ni reset", () => {
  const rbac = new RbacService();
  const teacher = {
    role: "Enseignant",
    permissions: [
      "Voir élèves",
      "Élèves:READ",
      "Messages parents",
      "Messages:READ",
      "Notes:READ",
      "Notes:CREATE",
    ],
  };
  assert.equal(rbac.canAccess(teacher, "POST /api/users/:id/reset-password"), false);
  assert.ok(routePermissions["GET /api/notes"].includes("Notes:READ"));
  assert.ok(routePermissions["GET /api/presences"].includes("Présences:READ"));
});

test("rollback transactionnel : une erreur mid-flight restaure l'état initial", async () => {
  const { repo, rolesStore } = createMemoryRepo([
    {
      roleCode: "enseignant",
      roleName: "Enseignant",
      permissions: PRODUCTION_TEACHER_ALIASES,
      delegationPermissions: PRODUCTION_TEACHER_ALIASES,
    },
  ]);
  const before = [...(await rolesStore.getRoleByNameOrCode("Enseignant")).permissions].sort();
  const originalAdd = rolesStore.addMissingPermissions.bind(rolesStore);
  let calls = 0;
  rolesStore.addMissingPermissions = async (...args) => {
    calls += 1;
    const added = await originalAdd(...args);
    if (calls >= 1) throw new Error("forced-reconciliation-failure");
    return added;
  };
  await assert.rejects(() => reconcileCanonicalSystemRoles(repo), /forced-reconciliation-failure/);
  const afterStore = repo.getEstablishmentRolesStore();
  const after = [...(await afterStore.getRoleByNameOrCode("Enseignant")).permissions].sort();
  assert.deepEqual(after, before);
});

test("production-like : Préfet / Directeur / Parent / Élève / Comptable refus puis autorisation", async () => {
  const cases = [
    {
      roleName: "Préfet des études",
      roleCode: "prefet_des_etudes",
      roleKey: "PREFET_ETUDES",
      aliases: ["Voir élèves", "Messages parents"],
      seedModule: "students",
      route: "GET /api/backoffice/messages",
      token: "Messages:READ",
    },
    {
      roleName: "Directeur",
      roleCode: "directeur",
      roleKey: "PRINCIPAL",
      aliases: ["Voir élèves"],
      seedModule: "grades",
      route: "GET /api/students",
      token: "Élèves:READ",
    },
    {
      roleName: "Parent",
      roleCode: "parent",
      roleKey: "PARENT",
      aliases: ["Voir enfant", "Messages école"],
      seedModule: "grades",
      route: "GET /api/backoffice/messages",
      token: "Messages:READ",
    },
    {
      roleName: "Élève / Étudiant",
      roleCode: "eleve_etudiant",
      roleKey: "STUDENT",
      aliases: ["Voir notes"],
      seedModule: "students",
      route: "GET /api/notes",
      token: "Notes:READ",
    },
    {
      roleName: "Comptable",
      roleCode: "comptable",
      roleKey: "ACCOUNTANT",
      aliases: ["Voir paiements"],
      seedModule: "reports",
      route: "GET /api/payments",
      token: "Paiements:READ",
    },
  ];
  const rbac = new RbacService();
  for (const item of cases) {
    const { repo, rbacStore } = createMemoryRepo([
      {
        roleCode: item.roleCode,
        roleName: item.roleName,
        permissions: item.aliases,
        delegationPermissions: item.aliases,
      },
    ]);
    await rbacStore.upsertGrant({
      roleKey: item.roleKey,
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: item.seedModule,
      canCreate: false,
      canRead: true,
      canUpdate: false,
      canDelete: false,
      updatedBy: "seed-prod",
    });
    const before = await resolveEffectivePermissionsForPrincipal(repo, {
      role: item.roleName,
      roleKeys: [item.roleKey],
    });
    assert.equal(
      rbac.canAccess({ role: item.roleName, permissions: before.permissions }, item.route),
      false,
      `${item.roleName} avant ${item.route}`,
    );
    await reconcileCanonicalSystemRoles(repo);
    const after = await resolveEffectivePermissionsForPrincipal(repo, {
      role: item.roleName,
      roleKeys: [item.roleKey],
    });
    assert.ok(after.permissions.includes(item.token), `${item.roleName} ${item.token}`);
    assert.equal(
      rbac.canAccess({ role: item.roleName, permissions: after.permissions }, item.route),
      true,
      `${item.roleName} après ${item.route}`,
    );
    assert.equal(
      after.permissions.includes("ALL_PRIVILEGES"),
      false,
      `${item.roleName} sans ALL_PRIVILEGES`,
    );
  }
});

test("non-régression autorités : SUPER_ADMIN global, COUNTRY_ADMIN et SCHOOL_ADMIN sans fuite enseignant", async () => {
  const { repo } = createMemoryRepo();
  await reconcileCanonicalSystemRoles(repo);
  const rbac = new RbacService();
  const superAdmin = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Super Administrateur Somafrik",
    roleKeys: ["SUPER_ADMIN"],
  });
  const country = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Admin Pays",
    roleKeys: ["COUNTRY_ADMIN"],
  });
  const school = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Admin School",
    roleKeys: ["SCHOOL_ADMIN"],
  });
  const teacher = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Enseignant",
    roleKeys: ["TEACHER"],
  });
  assert.equal(rbac.canAccess({ role: "Super Administrateur Somafrik", permissions: superAdmin.permissions }, "GET /api/students"), false);
  assert.equal(rbac.canAccess({ role: "Admin Pays", permissions: country.permissions }, "GET /api/students"), false);
  assert.equal(rbac.canAccess({ role: "Admin School", permissions: school.permissions }, "GET /api/students"), true);
  assert.equal(rbac.canAccess({ role: "Enseignant", permissions: teacher.permissions }, "POST /api/users/:id/reset-password"), false);
  assert.equal(teacher.permissions.includes("Utilisateurs:UPDATE"), false);
  assert.equal(teacher.permissions.includes("ALL_PRIVILEGES"), false);
  assert.equal(country.permissions.includes("ALL_PRIVILEGES"), false);
});

test("SQL de migration contient les jetons canoniques enseignant", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const sql = fs.readFileSync(
    path.join(__dirname, "../db/migrations/20260903_p0_system_roles_rbac_reconciliation.sql"),
    "utf8",
  );
  for (const token of ["Élèves:READ", "Messages:READ", "Notes:READ", "Présences:READ", "Classes:READ"]) {
    assert.match(sql, new RegExp(`\\('Enseignant', '${token}'\\)`));
  }
  assert.match(sql, /ON CONFLICT \(role_id, permission\) DO NOTHING/);
  assert.match(sql, /Pas d'OR sur un grant existant/);
});
