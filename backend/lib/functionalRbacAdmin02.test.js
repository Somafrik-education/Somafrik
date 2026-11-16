"use strict";

/**
 * ADMIN-02 — édition libellé rôle métier + historique RBAC.
 * Réutilise audit_logs. Pas de migration. Pas de Relations/Documents/Conformité.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  patchConfiguredPermissions,
  resetConfiguredPermissionOverrides,
  listRbacAuditHistory,
} = require("./functionalRbacService");
const { createRole, updateRole, archiveRole } = require("./establishmentRolesService");
const {
  FUNCTIONAL_RBAC_ERROR,
  RBAC_AUDIT_ACTIONS,
  RBAC_HISTORY_MAX_LIMIT,
  sanitizeRbacAuditValue,
} = require("./functionalRbacManagement");
const { createFunctionalRbacMemoryStore } = require("../db/functionalRbacMemoryStore");
const { createEstablishmentRolesMemoryStore } = require("../db/establishmentRolesMemoryStore");
const { RbacService, routePermissions } = require("../services/rbacService");
const { PLATFORM_ADMIN_ALLOWED, SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM } = require("./platformPersonalDataGuard");

const SUPER_ADMIN = {
  role: "Super Administrateur Somafrik",
  identifier: "superadmin",
  roleKeys: ["SUPER_ADMIN"],
};
const SCHOOL_ADMIN = { role: "Admin School", identifier: "school-admin", roleKeys: ["SCHOOL_ADMIN"] };
const HISTORY_ROUTE = "GET /api/backoffice/rbac/history";

function walkValues(value, visit) {
  if (value == null) return;
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walkValues(item, visit);
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      visit(key);
      walkValues(nested, visit);
    }
  }
}

function assertNoSecrets(payload) {
  const forbiddenKeys = new Set(["jwt", "password", "pin", "secret", "token", "authorization", "accesstoken", "refreshtoken"]);
  walkValues(payload, (value) => {
    if (typeof value === "string") {
      assert.equal(forbiddenKeys.has(value.toLowerCase()), false, value);
      assert.equal(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value.trim()), false, value);
      assert.equal(value.includes("hunter2"), false);
    }
  });
  if (payload && typeof payload === "object") {
    for (const key of Object.keys(payload.oldValue || {})) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, key);
    }
    for (const key of Object.keys(payload.newValue || {})) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, key);
    }
  }
  void sanitizeRbacAuditValue(payload);
}

function rolesRepo() {
  const store = createEstablishmentRolesMemoryStore({
    roles: [
      {
        id: "role-super",
        roleCode: "SUPER_ADMIN",
        roleName: "Super Administrateur Somafrik",
        scope: "platform",
        schoolAssignable: false,
      },
      {
        id: "role-country",
        roleCode: "COUNTRY_ADMIN",
        roleName: "Admin Pays",
        scope: "country",
        schoolAssignable: false,
      },
      {
        id: "role-school",
        roleCode: "SCHOOL_ADMIN",
        roleName: "Admin School",
        scope: "school",
        schoolAssignable: false,
      },
    ],
  });
  const audits = [];
  const repo = {
    getEstablishmentRolesStore: () => store,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async (entry) => {
      audits.push(entry);
      return true;
    },
    getAuditLogs: async ({ actions, limit = 20, offset = 0 } = {}) =>
      audits
        .filter((row) => !actions?.length || actions.includes(row.action))
        .slice(offset, offset + limit)
        .map((row, index) => ({
          id: `AUD-${index}`,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          oldValue: row.oldValue,
          newValue: row.newValue,
          createdAt: new Date().toISOString(),
          actor: row.newValue?.actor || "system",
        })),
  };
  return { repo, store, audits };
}

function rbacRepo() {
  const rbac = createFunctionalRbacMemoryStore({
    resolveCountryAndSchool: async ({ schoolCode, countryCode }) => {
      if (countryCode === "BI" && !schoolCode) {
        return { country: { id: "bi", code: "BI" }, school: null };
      }
      return {
        country: { id: "cd", code: "CD" },
        school: { id: "nuru", school_code: "CD-2026-0001", country_id: "cd", country_code: "CD" },
      };
    },
  });
  const audits = [];
  const repo = {
    getFunctionalRbacStore: () => rbac,
    createTxScope: () => repo,
    withTransaction: async (fn) => fn(repo),
    recordAudit: async (entry) => {
      audits.push(entry);
      return true;
    },
    getAuditLogs: async ({ actions, limit = 20, offset = 0 } = {}) =>
      audits
        .filter((row) => !actions?.length || actions.includes(row.action))
        .slice(offset, offset + limit)
        .map((row, index) => ({
          id: `AUD-${index}`,
          action: row.action,
          oldValue: row.oldValue,
          newValue: row.newValue,
          createdAt: new Date().toISOString(),
          actor: row.newValue?.actor || "system",
        })),
  };
  return { repo, rbac, audits };
}

test("A02-01 Superadmin renomme un rôle métier → persistance et relecture", async () => {
  const { repo, store } = rolesRepo();
  const created = await createRole(repo, { roleName: "Auditeur métier", roleCode: "AUDITEUR_METIER" }, SUPER_ADMIN, {});
  const renamed = await updateRole(repo, created.id, { roleName: "Auditeur senior" }, SUPER_ADMIN, {});
  assert.equal(renamed.roleName, "Auditeur senior");
  assert.equal(renamed.roleCode, created.roleCode);
  const reread = await store.getRoleById(created.id);
  assert.equal(reread.roleName, "Auditeur senior");
  assert.equal(reread.roleCode, created.roleCode);
  assert.equal(reread.roleCode, "auditeur_metier");
});

test("A02-02 SUPER_ADMIN rename → refus backend", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => updateRole(repo, "role-super", { roleName: "Nouveau Super" }, SUPER_ADMIN, {}),
    (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
  );
});

test("A02-03 COUNTRY_ADMIN rename → refus backend", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => updateRole(repo, "role-country", { roleName: "Nouveau Pays" }, SUPER_ADMIN, {}),
    (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
  );
});

test("A02-04 SCHOOL_ADMIN rename → refus backend", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => updateRole(repo, "role-school", { roleName: "Nouveau School" }, SUPER_ADMIN, {}),
    (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
  );
});

test("A02-05 archive rôle système → refus", async () => {
  const { repo } = rolesRepo();
  for (const roleId of ["role-super", "role-country", "role-school"]) {
    await assert.rejects(
      () => archiveRole(repo, roleId, SUPER_ADMIN, {}),
      (error) => error.statusCode === 403 && error.code === FUNCTIONAL_RBAC_ERROR.ROLE_PROTECTED,
    );
  }
});

test("A02-06 rename ne change jamais roleKey/roleCode", async () => {
  const { repo, store } = rolesRepo();
  const created = await createRole(repo, { roleName: "Secrétaire pédagogique", roleCode: "SECRETAIRE_PEDAGO" }, SUPER_ADMIN, {});
  const renamed = await updateRole(
    repo,
    created.id,
    { roleName: "Secrétaire pédagogique senior", roleCode: "HACKED_CODE", roleKey: "HACKED_KEY", scope: "platform" },
    SUPER_ADMIN,
    {},
  );
  assert.equal(renamed.roleCode, created.roleCode);
  const reread = await store.getRoleById(created.id);
  assert.equal(reread.roleCode, created.roleCode);
  assert.equal(reread.roleCode, "secretaire_pedago");
  assert.equal(reread.scope, "school");
});

test("A02-07 ROLE_CREATE produit audit persistant", async () => {
  const { repo, audits } = rolesRepo();
  const created = await createRole(repo, { roleName: "Contrôleur RBAC", roleCode: "CONTROLEUR_RBAC" }, SUPER_ADMIN, {});
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.ROLE_CREATE);
  assert.ok(entry, "ROLE_CREATE doit être persisté");
  assert.equal(entry.entityType, "establishment_role");
  assert.equal(entry.entityId, created.id);
  assert.equal(entry.newValue.roleName, "Contrôleur RBAC");
  assert.equal(entry.newValue.roleCode, created.roleCode);
  assert.equal(entry.newValue.actor, "superadmin");
});

test("A02-08 ROLE_RENAME produit audit before/after", async () => {
  const { repo, audits } = rolesRepo();
  const created = await createRole(repo, { roleName: "Auditeur A", roleCode: "AUDITEUR_A" }, SUPER_ADMIN, {});
  await updateRole(repo, created.id, { roleName: "Auditeur B" }, SUPER_ADMIN, {});
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.ROLE_RENAME);
  assert.ok(entry);
  assert.equal(entry.oldValue.roleName, "Auditeur A");
  assert.equal(entry.newValue.roleName, "Auditeur B");
  assert.equal(entry.oldValue.roleCode, created.roleCode);
  assert.equal(entry.newValue.roleCode, created.roleCode);
  assert.equal(entry.newValue.actor, "superadmin");
});

test("A02-09 ROLE_ARCHIVE produit audit", async () => {
  const { repo, audits } = rolesRepo();
  const created = await createRole(repo, { roleName: "Rôle temporaire", roleCode: "ROLE_TEMP" }, SUPER_ADMIN, {});
  await archiveRole(repo, created.id, SUPER_ADMIN, {});
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.ROLE_ARCHIVE);
  assert.ok(entry);
  assert.equal(entry.oldValue.roleName, "Rôle temporaire");
  assert.equal(entry.newValue.status, "archived");
});

test("A02-10 permission PATCH produit audit before/after", async () => {
  const { repo, rbac, audits } = rbacRepo();
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: "students",
    canCreate: false,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "bootstrap",
  });
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
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.PERMISSION_OVERRIDE_CREATE_OR_UPDATE);
  assert.ok(entry);
  assert.equal(entry.oldValue.moduleKey, "students");
  assert.equal(entry.oldValue.crud.canCreate, false);
  assert.equal(entry.newValue.crud.canCreate, true);
  assert.equal(entry.newValue.roleKey, "PREFET_ETUDES");
  assert.equal(entry.newValue.scopeType, "school");
  assert.equal(entry.newValue.schoolCode, "CD-2026-0001");
  assert.equal(entry.newValue.actor, "superadmin");
});

test("A02-11 reset override produit audit et référence l'héritage retrouvé", async () => {
  const { repo, rbac, audits } = rbacRepo();
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    countryId: null,
    schoolId: null,
    moduleKey: "students",
    canCreate: false,
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "bootstrap",
  });
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
  await resetConfiguredPermissionOverrides(
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
  const entry = audits.find((row) => row.action === RBAC_AUDIT_ACTIONS.PERMISSION_OVERRIDE_RESET);
  assert.ok(entry);
  assert.equal(entry.oldValue.source, "school");
  assert.equal(entry.oldValue.crud.canUpdate, false);
  assert.equal(entry.newValue.inherited, true);
  assert.equal(entry.newValue.source, "global");
  assert.equal(entry.newValue.crud.canUpdate, true);
  assert.equal(entry.newValue.crud.canDelete, true);
});

test("A02-12 SCHOOL_ADMIN ne peut pas consulter l'historique global", async () => {
  const { repo } = rolesRepo();
  await assert.rejects(
    () => listRbacAuditHistory(repo, { limit: 20, offset: 0 }, SCHOOL_ADMIN),
    (error) => error.statusCode === 403,
  );
  const rbac = new RbacService();
  assert.equal(rbac.canAccess({ role: "Admin School", permissions: ["Paramètres Établissement:READ"] }, HISTORY_ROUTE), false);
});

test("A02-13 requête historique sans permission → fail-closed", async () => {
  const rbac = new RbacService();
  assert.deepEqual(routePermissions[HISTORY_ROUTE], ["ALL_PRIVILEGES"]);
  assert.equal(rbac.canAccess(null, HISTORY_ROUTE), false);
  assert.equal(rbac.canAccess({ role: "Secrétaire", permissions: [] }, HISTORY_ROUTE), false);
  assert.equal(rbac.canAccess({ role: "Admin School", permissions: ["Paramètres Établissement:READ"] }, HISTORY_ROUTE), false);
  assert.equal(rbac.canAccess({ role: "Super Administrateur Somafrik" }, HISTORY_ROUTE), true);
  assert.equal(PLATFORM_ADMIN_ALLOWED.includes(HISTORY_ROUTE), true);
  assert.equal(SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM.includes(HISTORY_ROUTE), false);
  const { repo } = rolesRepo();
  await assert.rejects(
    () => listRbacAuditHistory(repo, {}, { role: "Secrétaire", identifier: "sec" }),
    (error) => error.statusCode === 403,
  );
});

test("A02-14 pagination historique → limite appliquée côté serveur", async () => {
  const { repo, audits } = rolesRepo();
  for (let index = 0; index < 60; index += 1) {
    audits.push({
      action: RBAC_AUDIT_ACTIONS.ROLE_RENAME,
      entityType: "establishment_role",
      entityId: `role-${index}`,
      oldValue: { roleName: `Avant ${index}` },
      newValue: { roleName: `Après ${index}`, actor: "superadmin" },
    });
  }
  const page = await listRbacAuditHistory(repo, { limit: 9999, offset: 0 }, SUPER_ADMIN);
  assert.equal(page.limit, RBAC_HISTORY_MAX_LIMIT);
  assert.ok(page.items.length <= RBAC_HISTORY_MAX_LIMIT);
  assert.equal(page.items.length, RBAC_HISTORY_MAX_LIMIT);
  assert.equal(page.hasMore, true);
  const next = await listRbacAuditHistory(repo, { limit: 20, offset: 20 }, SUPER_ADMIN);
  assert.equal(next.offset, 20);
  assert.equal(next.limit, 20);
  assert.equal(next.items.length, 20);
});

test("A02-15 aucun secret/token/password dans payload d'audit", async () => {
  const dirty = {
    ...SUPER_ADMIN,
    jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb",
    password: "hunter2",
    pin: "0000",
    token: "refresh-token",
    secret: "top-secret",
    authorization: "Bearer abc",
  };
  const { repo: roles, audits: roleAudits } = rolesRepo();
  const created = await createRole(roles, { roleName: "Rôle propre", roleCode: "ROLE_PROPRE" }, dirty, {});
  await updateRole(roles, created.id, { roleName: "Rôle propre 2" }, dirty, {});
  const { repo, rbac, audits } = rbacRepo();
  await rbac.upsertGrant({
    roleKey: "PREFET_ETUDES",
    scopeType: "global",
    moduleKey: "students",
    canRead: true,
    canUpdate: true,
    canDelete: true,
    updatedBy: "bootstrap",
  });
  const patched = await patchConfiguredPermissions(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: "CD-2026-0001",
      grants: [{ moduleKey: "students", canCreate: true, canRead: true, canUpdate: true, canDelete: true }],
    },
    dirty,
    {},
  );
  await resetConfiguredPermissionOverrides(
    repo,
    {
      roleKey: "PREFET_ETUDES",
      schoolCode: "CD-2026-0001",
      moduleKey: "students",
      expectedUpdatedAt: patched.updatedAt,
    },
    dirty,
    {},
  );
  for (const entry of [...roleAudits, ...audits]) {
    assertNoSecrets(entry);
    assert.equal(entry.oldValue?.password, undefined);
    assert.equal(entry.newValue?.password, undefined);
    assert.equal(entry.oldValue?.jwt, undefined);
    assert.equal(entry.newValue?.jwt, undefined);
    assert.equal(entry.oldValue?.pin, undefined);
    assert.equal(entry.newValue?.pin, undefined);
    assert.equal(entry.oldValue?.token, undefined);
    assert.equal(entry.newValue?.token, undefined);
    assert.equal(entry.oldValue?.secret, undefined);
    assert.equal(entry.newValue?.secret, undefined);
  }
});
