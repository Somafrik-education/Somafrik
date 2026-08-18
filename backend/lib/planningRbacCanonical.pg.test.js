"use strict";

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { ESTABLISHMENT_ROLES_SCHEMA_SQL } = require("../db/establishmentRolesSchema");
const { FUNCTIONAL_RBAC_SCHEMA_SQL } = require("../db/functionalRbacSchema");
const { createEstablishmentRolesPgStore } = require("../db/establishmentRolesPgStore");
const { createFunctionalRbacPgStore } = require("../db/functionalRbacPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureFunctionalRbacBootstrap, resolveEffectivePermissionsForPrincipal } = require("./functionalRbacService");
const { PLANNING_MODULE_KEY } = require("./planningRbacCanonical");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_PLANNING_RBAC_IT_DATABASE ?? "somafrik_planning_rbac_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const maintenance = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenance });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function createRepo(pool) {
  const repo = {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    getEstablishmentRolesStore: () => createEstablishmentRolesPgStore(repo),
    getFunctionalRbacStore: () => createFunctionalRbacPgStore(repo),
    createTxScope(tx) {
      if (!tx) return repo;
      const scoped = {
        ...repo,
        query: (sql, params) => tx.query(sql, params),
        one: async (sql, params) => (await tx.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await tx.query(sql, params)).rows,
      };
      scoped.getFunctionalRbacStore = () => createFunctionalRbacPgStore(scoped);
      scoped.getEstablishmentRolesStore = () => createEstablishmentRolesPgStore(scoped);
      return scoped;
    },
    withTransaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = createTxAdapter(client);
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
  return repo;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("planningRbacCanonical.pg.test: SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  const repo = createRepo(pool);
  const store = repo.getFunctionalRbacStore();
  const roles = repo.getEstablishmentRolesStore();
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(ESTABLISHMENT_ROLES_SCHEMA_SQL);
    await pool.query(FUNCTIONAL_RBAC_SCHEMA_SQL);

    await roles.insertRole({
      roleCode: "PREFET_ETUDES",
      roleName: "Préfet des études",
      scope: "school",
      permissions: ["Voir notes", "Voir présences"],
      delegationPermissions: ["Voir notes"],
    });
    await roles.insertRole({
      roleCode: "TEACHER",
      roleName: "Enseignant",
      scope: "school",
      permissions: ["Voir notes"],
      delegationPermissions: ["Voir notes"],
    });
    await roles.insertRole({
      roleCode: "SECRETARY",
      roleName: "Secrétaire",
      scope: "school",
      permissions: ["Élèves:READ"],
      delegationPermissions: ["Élèves:READ"],
    });

    await store.seedFunctionalModules();
    await store.upsertGrant({
      roleKey: "PREFET_ETUDES",
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: "students",
      canRead: true,
      updatedBy: "pre-migration",
    });
    await store.upsertGrant({
      roleKey: "TEACHER",
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: "grades",
      canRead: true,
      updatedBy: "pre-migration",
    });
    await store.upsertGrant({
      roleKey: "SECRETARY",
      scopeType: "global",
      countryId: null,
      schoolId: null,
      moduleKey: "students",
      canRead: true,
      updatedBy: "pre-migration",
    });

    const before = await store.listGrantsForRoles(["PREFET_ETUDES", "TEACHER"]);
    assert.equal(
      before.some((row) => row.moduleKey === PLANNING_MODULE_KEY),
      false,
    );

    await ensureFunctionalRbacBootstrap(repo);
    await ensureFunctionalRbacBootstrap(repo);

    const prefet = await resolveEffectivePermissionsForPrincipal(repo, {
      role: "Préfet des études",
      roleKeys: ["PREFET_ETUDES"],
    });
    assert.ok(prefet.permissions.includes("Planning de cours:READ"));
    assert.ok(prefet.permissions.includes("Planning de cours:CREATE"));
    assert.ok(prefet.permissions.includes("Planning de cours:UPDATE"));
    assert.ok(prefet.permissions.includes("Planning de cours:DELETE"));

    const teacher = await resolveEffectivePermissionsForPrincipal(repo, {
      role: "Enseignant",
      roleKeys: ["TEACHER"],
    });
    assert.ok(teacher.permissions.includes("Planning de cours:READ"));
    assert.equal(teacher.permissions.includes("Planning de cours:CREATE"), false);

    const secretary = await resolveEffectivePermissionsForPrincipal(repo, {
      role: "Secrétaire",
      roleKeys: ["SECRETARY"],
    });
    assert.equal(secretary.permissions.includes("Planning de cours:READ"), false);

    console.log("OK pg: réconciliation Planning Prefet/Teacher sur rôle préexistant");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
