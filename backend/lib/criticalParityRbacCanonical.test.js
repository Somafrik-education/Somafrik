"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ensureFunctionalRbacBootstrap, resolveEffectivePermissionsForPrincipal } = require("./functionalRbacService");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { RbacService } = require("../services/rbacService");
const {
  CANONICAL_CRITICAL_PARITY_GRANTS,
  CRITICAL_PARITY_EXCLUDED_ROLE_KEYS,
  reconcileCanonicalCriticalParityGrants,
} = require("./criticalParityRbacCanonical");

const rbac = new RbacService({ rolePermissions: {} });

function emptyCatalogRepo(store) {
  return {
    getFunctionalRbacStore: () => store,
    getEstablishmentRolesStore: () => ({
      getPermissionsMap: async () => ({
        Comptable: ["Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE"],
        ACCOUNTANT: ["Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE"],
        Enseignant: ["Notes:READ", "Notes:CREATE", "Présences:READ"],
        TEACHER: ["Notes:READ", "Notes:CREATE", "Présences:READ"],
        "Préfet des études": ["Voir notes", "Voir présences"],
        PREFET_ETUDES: ["Voir notes", "Voir présences"],
        Parent: ["Notes:READ"],
        PARENT: ["Notes:READ"],
        "Élève / Étudiant": ["Notes:READ"],
        STUDENT: ["Notes:READ"],
      }),
      getRoleByNameOrCode: async () => ({ id: "existing" }),
      insertRole: async () => {},
      markSystemProtected: async () => true,
    }),
    listActiveUserRoleKeys: async () => null,
  };
}

async function seedStaleGrants(store) {
  await store.upsertGrant({
    roleKey: "ACCOUNTANT",
    scopeType: "global",
    moduleKey: "payments",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "pre-j3",
  });
  await store.upsertGrant({
    roleKey: "TEACHER",
    scopeType: "global",
    moduleKey: "grades",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "pre-j3",
  });
  await store.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "teachers",
    canCreate: true,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "pre-j3",
  });
  await store.upsertGrant({
    roleKey: "PARENT",
    scopeType: "global",
    moduleKey: "grades",
    canRead: true,
    updatedBy: "pre-j3",
  });
}

test("bootstrap J3 ajoute Affectations:READ enseignant et Affectations CRUD préfet sans ouvrir Élèves au comptable", async () => {
  const store = createFunctionalRbacMemoryStore();
  await seedStaleGrants(store);
  const repo = emptyCatalogRepo(store);

  const beforeAccountant = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Comptable",
    roleKeys: ["ACCOUNTANT"],
  });
  assert.equal(beforeAccountant.permissions.includes("Élèves:READ"), false);
  assert.equal(
    rbac.canAccess({ role: "Comptable", permissions: beforeAccountant.permissions }, "GET /api/students"),
    false,
  );

  await ensureFunctionalRbacBootstrap(repo);
  const countAfterFirst = await store.countActiveGrants();
  await ensureFunctionalRbacBootstrap(repo);
  assert.equal(await store.countActiveGrants(), countAfterFirst, "réconciliation J3 idempotente");

  const accountant = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Comptable",
    roleKeys: ["ACCOUNTANT"],
  });
  assert.equal(accountant.permissions.includes("Élèves:READ"), false, "le Comptable ne reçoit pas l'annuaire Élèves");
  assert.equal(
    rbac.canAccess({ role: "Comptable", permissions: accountant.permissions }, "GET /api/students"),
    false,
  );

  const accountantStudentGrants = await store.listGrantsForScope({
    roleKey: "ACCOUNTANT",
    scopeType: "global",
    countryId: null,
    schoolId: null,
  });
  assert.equal(
    accountantStudentGrants.some((row) => row.moduleKey === "students"),
    false,
    "la réconciliation ne crée aucun grant students pour ACCOUNTANT",
  );

  const teacher = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Enseignant",
    roleKeys: ["TEACHER"],
  });
  assert.ok(teacher.permissions.includes("Affectations:READ"));
  assert.equal(teacher.permissions.includes("Affectations:CREATE"), false);
  assert.equal(teacher.permissions.includes("Affectations:UPDATE"), false);
  assert.equal(teacher.permissions.includes("Affectations:DELETE"), false);
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: teacher.permissions }, "GET /api/assignments"),
    true,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: teacher.permissions }, "POST /api/assignments"),
    false,
  );
  assert.equal(
    rbac.canAccess({ role: "Enseignant", permissions: teacher.permissions }, "GET /api/courses"),
    false,
    "Affectations:READ ne doit pas ouvrir le catalogue global des cours",
  );

  const prefet = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Préfet des études",
    roleKeys: ["PREFET_ETUDES"],
  });
  assert.ok(prefet.permissions.includes("Affectations:CREATE"));
  assert.ok(prefet.permissions.includes("Affectations:READ"));
  assert.ok(prefet.permissions.includes("Affectations:UPDATE"));
  assert.ok(prefet.permissions.includes("Affectations:DELETE"));
  assert.equal(
    rbac.canAccess({ role: "Préfet des études", permissions: prefet.permissions }, "POST /api/assignments"),
    true,
  );

  const parent = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Parent",
    roleKeys: ["PARENT"],
  });
  assert.equal(parent.permissions.includes("Affectations:READ"), false);
  assert.equal(parent.permissions.includes("Élèves:CREATE"), false);

  const student = await resolveEffectivePermissionsForPrincipal(repo, {
    role: "Élève / Étudiant",
    roleKeys: ["STUDENT"],
  });
  assert.equal(student.permissions.includes("Affectations:READ"), false);
});

test("réconciliation J3 ne touche pas un grant students préexistant du comptable", async () => {
  const store = createFunctionalRbacMemoryStore();
  await store.upsertGrant({
    roleKey: "ACCOUNTANT",
    scopeType: "global",
    moduleKey: "students",
    canCreate: false,
    canRead: false,
    canUpdate: false,
    canDelete: false,
    updatedBy: "custom",
  });
  const changed = await reconcileCanonicalCriticalParityGrants(store);
  assert.equal(changed, 2, "seuls teacher + prefet sont réconciliés");
  const accountant = (await store.listGrantsForScope({
    roleKey: "ACCOUNTANT",
    scopeType: "global",
    countryId: null,
    schoolId: null,
  })).find((row) => row.moduleKey === "students");
  assert.equal(accountant.canCreate, false);
  assert.equal(accountant.canRead, false);
  assert.equal(accountant.canUpdate, false);
  assert.equal(accountant.canDelete, false);
});

test("ensureFunctionalRbacBootstrap appelle la réconciliation J3 fail-closed", () => {
  const source = fs.readFileSync(path.join(__dirname, "functionalRbacService.js"), "utf8");
  assert.match(source, /reconcileCanonicalCriticalParityGrants/);
  assert.equal(CANONICAL_CRITICAL_PARITY_GRANTS.length, 2);
  assert.deepEqual(
    CANONICAL_CRITICAL_PARITY_GRANTS.map((grant) => [grant.roleKey, grant.moduleKey]),
    [["TEACHER", "assignments"], ["PREFET_ETUDES", "assignments"]],
  );
  assert.ok(CRITICAL_PARITY_EXCLUDED_ROLE_KEYS.includes("ACCOUNTANT"));
  assert.ok(CRITICAL_PARITY_EXCLUDED_ROLE_KEYS.includes("PARENT"));
  assert.ok(CRITICAL_PARITY_EXCLUDED_ROLE_KEYS.includes("STUDENT"));
});
