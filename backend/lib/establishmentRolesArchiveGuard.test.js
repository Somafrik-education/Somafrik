"use strict";

/**
 * RBAC-LOGIN-01 — garde d'archivage : comptage des affectations (unitaire, sans base).
 * Le comptage exact, l'index et le plan sont vérifiés sur PostgreSQL dans
 * rbacLogin01CustomRoles.http.pg.test.js (RL01-15).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createEstablishmentRolesPgStore,
  COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL,
  ROLE_ASSIGNMENT_PREREQUISITES_SQL,
} = require("../db/establishmentRolesPgStore");
const { archiveRole } = require("./establishmentRolesService");

const ROLE = { roleCode: "delegue_de_classe", roleName: "Délégué de classe" };

function storeWith({ prerequisites = { user_roles: true, normalize_fn: true }, count, prerequisitesError, countError } = {}) {
  const calls = [];
  const one = async (sql, params) => {
    calls.push({ sql, params });
    if (sql === ROLE_ASSIGNMENT_PREREQUISITES_SQL) {
      if (prerequisitesError) throw prerequisitesError;
      return prerequisites;
    }
    if (sql === COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL) {
      if (countError) throw countError;
      return count;
    }
    throw new Error(`requête inattendue : ${sql}`);
  };
  const all = async () => {
    throw new Error("aucune lecture de toutes les affectations n'est attendue");
  };
  return { store: createEstablishmentRolesPgStore({ one, all, query: one }), calls };
}

const isUnavailable = (error) => error?.statusCode === 503 && error?.code === "ROLE_ASSIGNMENTS_UNAVAILABLE";

test("comptage filtré et agrégé dans PostgreSQL (une requête paramétrée, aucun chargement en Node.js)", async () => {
  const { store, calls } = storeWith({ count: { active_assignments: 4, schools: 2, platform_assignments: 1 } });
  assert.deepEqual(await store.countActiveAssignmentsForRole(ROLE), {
    activeAssignments: 4,
    schools: 2,
    platformAssignments: 1,
  });
  const countCall = calls.find((call) => call.sql === COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL);
  assert.deepEqual(countCall.params, ["delegue_de_classe", "Délégué de classe"]);
  assert.match(COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL, /somafrik_normalize_role_code\(ur\.role_key\)\s*=\s*ANY/);
  assert.match(COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL, /ur\.status = 'active'/);
  assert.match(COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL, /ur\.revoked_at IS NULL/);
  assert.match(COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL, /COUNT\(DISTINCT ur\.school_id\)/);
  assert.doesNotMatch(COUNT_ACTIVE_ROLE_ASSIGNMENTS_SQL, /GROUP BY/);
});

test("prédicats alignés sur l'index partiel idx_user_roles_active_normalized_key", () => {
  const { USER_ROLES_ACTIVE_NORMALIZED_KEY_INDEX_SQL } = require("../db/userRolesSchema");
  assert.match(USER_ROLES_ACTIVE_NORMALIZED_KEY_INDEX_SQL, /idx_user_roles_active_normalized_key/);
  assert.match(USER_ROLES_ACTIVE_NORMALIZED_KEY_INDEX_SQL, /\(somafrik_normalize_role_code\(role_key\)\)/);
  assert.match(USER_ROLES_ACTIVE_NORMALIZED_KEY_INDEX_SQL, /WHERE status = 'active' AND revoked_at IS NULL/);
  assert.match(USER_ROLES_ACTIVE_NORMALIZED_KEY_INDEX_SQL, /IF NOT EXISTS/);
});

test("fail-closed : table ou fonction absente, lecture en échec, résultat invalide, rôle vide", async () => {
  const cases = [
    storeWith({ prerequisites: { user_roles: false, normalize_fn: true } }),
    storeWith({ prerequisites: { user_roles: true, normalize_fn: false } }),
    storeWith({ prerequisites: null }),
    storeWith({ prerequisitesError: new Error("down") }),
    storeWith({ countError: new Error("timeout") }),
    storeWith({ count: null }),
    storeWith({ count: { active_assignments: "x", schools: 0, platform_assignments: 0 } }),
  ];
  for (const { store } of cases) {
    await assert.rejects(store.countActiveAssignmentsForRole(ROLE), isUnavailable);
  }
  const { store } = storeWith({ count: { active_assignments: 0, schools: 0, platform_assignments: 0 } });
  await assert.rejects(store.countActiveAssignmentsForRole({ roleCode: "", roleName: "" }), isUnavailable);
});

test("archiveRole : comptage indisponible → 503, rôle non archivé, aucun audit d'archivage", async () => {
  let archived = false;
  const audits = [];
  const fakeStore = {
    getRoleById: async () => ({ id: "r1", roleCode: "delegue", roleName: "Délégué", status: "active" }),
    lockRoleForArchive: async () => ({ id: "r1", roleCode: "delegue", roleName: "Délégué", status: "active" }),
    countActiveAssignmentsForRole: async () => {
      const error = new Error("indisponible");
      error.statusCode = 503;
      error.code = "ROLE_ASSIGNMENTS_UNAVAILABLE";
      throw error;
    },
    archiveRole: async () => {
      archived = true;
      return { id: "r1", status: "archived" };
    },
  };
  const repo = {
    getEstablishmentRolesStore: () => fakeStore,
    withTransaction: async (fn) => fn({}),
    createTxScope: () => repo,
    recordAudit: async (entry) => audits.push(entry.action),
  };
  await assert.rejects(
    archiveRole(repo, "r1", { role: "Super Administrateur Somafrik", roleKeys: ["SUPER_ADMIN"], sub: "u1" }, {}),
    isUnavailable,
  );
  assert.equal(archived, false);
  assert.deepEqual(audits, []);
});
