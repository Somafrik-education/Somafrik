"use strict";

/**
 * SEC-RBAC-REVOKE-01 — un rôle explicitement révoqué n'est jamais recréé au boot.
 *
 * Source de vérité des attributions : `user_roles`. `users.role` (rôle primaire
 * affiché) et `users.profile_payload.secondaryRoles` sont des données héritées :
 * le boot ne s'en sert que pour migrer un compte qui n'a encore AUCUNE décision
 * canonique pour ce rôle. Une ligne révoquée (user, établissement, rôle) est une
 * décision explicite : seul un nouvel octroi via l'API peut la renverser.
 *
 * Base jetable `somafrik_sec_rbac_revoke_01_it` (DROP SCHEMA public au début).
 * Les deux chemins de boot sont rejoués : ensureUserRolesCanonicalSchema
 * (chaque démarrage, production comprise) et ensureSeededUserRoles (seed démo).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");
const { USER_ROLES_SCHEMA_SQL } = require("../db/userRolesSchema");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { guardPgPool } = require("./pgPoolGuard");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_SEC_RBAC_REVOKE_01_IT_DATABASE ?? "somafrik_sec_rbac_revoke_01_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const skip = DATABASE_URL ? false : "DATABASE_URL absent";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

let pool = null;
let store = null;
/** Lecture utilisée par le RBAC live (liveRbacPrincipalAuthority) : rôles actifs bornés à l'établissement. */
const effectiveRoleKeys = (userId, schoolId) => store.bind({}).listActiveUserRoleKeysForSchool(userId, schoolId);
let principalA = null;
let schoolA = null;
let schoolB = null;
const auditMeta = { ipAddress: "127.0.0.1", userAgent: "sec-rbac-revoke-01" };

function createRepo(target) {
  return {
    query: (sql, params) => target.query(sql, params),
    one: async (sql, params) => (await target.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await target.query(sql, params)).rows,
    withTransaction: async (fn) => {
      const client = await target.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(createTxAdapter(client));
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
}

/** Rejoue les deux chemins de boot qui écrivent user_roles depuis les données héritées. */
async function boot() {
  const adapter = {
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    query: (sql, params) => pool.query(sql, params),
  };
  await PostgresRepository.prototype.ensureUserRolesCanonicalSchema.call(adapter);
  await PostgresRepository.prototype.ensureSeededUserRoles.call(adapter);
}

async function activeRoles(userId) {
  const result = await pool.query(
    `SELECT role_key FROM user_roles
     WHERE user_id = $1 AND status = 'active' AND revoked_at IS NULL
     ORDER BY role_key`,
    [userId],
  );
  return result.rows.map((row) => row.role_key);
}

async function roleHistory(userId, roleKey) {
  const result = await pool.query(
    `SELECT status FROM user_roles WHERE user_id = $1 AND role_key = $2 ORDER BY created_at, id`,
    [userId, roleKey],
  );
  return result.rows.map((row) => row.status);
}

async function insertLegacyUser({ code, email, role, secondaryRoles = [], schoolId }) {
  const result = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status, profile_payload)
     VALUES ($1, $2, 'Compte', $3, $4, $5, 'active', $6::jsonb)
     RETURNING id`,
    [schoolId, code, code, email, role, JSON.stringify({ secondaryRoles })],
  );
  return result.rows[0].id;
}

before(async () => {
  if (!DATABASE_URL) return;
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DB]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DB}`);
  } finally {
    await admin.end();
  }
  pool = guardPgPool(new Pool({ connectionString: withDatabaseName(DATABASE_URL, IT_DB) }));
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8"));
  await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
  await pool.query(USER_ROLES_SCHEMA_SQL);

  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  schoolA = (
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'École A', 'active') RETURNING id`,
      [country.rows[0].id],
    )
  ).rows[0].id;
  schoolB = (
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0002', 'École B', 'active') RETURNING id`,
      [country.rows[0].id],
    )
  ).rows[0].id;
  const actor = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, email, role, status)
     VALUES ($1, 'USR-ACTOR-REVOKE', 'Admin', 'A', 'actor.revoke@test.local', 'Admin School', 'active')
     RETURNING id`,
    [schoolA],
  );
  store = createClientsPgStore(createRepo(pool));
  principalA = { sub: actor.rows[0].id, role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
});

after(async () => {
  if (pool) await pool.end();
});

test("migration légitime : un compte hérité sans user_roles reçoit ses rôles au boot", { skip }, async () => {
  const userId = await insertLegacyUser({
    code: "USR-LEGACY-MIG",
    email: "legacy.mig@test.local",
    role: "Comptable",
    secondaryRoles: ["Secrétaire"],
    schoolId: schoolA,
  });
  await boot();
  assert.deepEqual(await activeRoles(userId), ["ACCOUNTANT", "SECRETARY"]);
  await boot();
  assert.deepEqual(await activeRoles(userId), ["ACCOUNTANT", "SECRETARY"], "boot idempotent, aucun doublon");
});

test("rôle secondaire hérité révoqué via l'API : jamais recréé au boot", { skip }, async () => {
  const userId = await insertLegacyUser({
    code: "USR-LEGACY-SEC",
    email: "legacy.sec@test.local",
    role: "Comptable",
    secondaryRoles: ["Secrétaire"],
    schoolId: schoolA,
  });
  await boot();
  assert.deepEqual(await activeRoles(userId), ["ACCOUNTANT", "SECRETARY"]);

  await store.revokeUserRole(userId, { role: "Secrétaire" }, principalA, auditMeta);
  assert.deepEqual(await activeRoles(userId), ["ACCOUNTANT"]);

  await boot();
  await boot();
  assert.deepEqual(await activeRoles(userId), ["ACCOUNTANT"], "SECRETARY révoqué reste révoqué après redémarrage");
  assert.deepEqual(await roleHistory(userId, "SECRETARY"), ["revoked"], "aucune nouvelle ligne active");
  assert.deepEqual(
    await effectiveRoleKeys(userId, schoolA),
    ["ACCOUNTANT"],
    "permissions effectives : rôle révoqué absent",
  );
});

test("rôle primaire hérité révoqué via l'API : jamais recréé au boot", { skip }, async () => {
  const userId = await insertLegacyUser({
    code: "USR-LEGACY-PRI",
    email: "legacy.pri@test.local",
    role: "Comptable",
    secondaryRoles: ["Secrétaire"],
    schoolId: schoolA,
  });
  await boot();
  await store.revokeUserRole(userId, { role: "Comptable" }, principalA, auditMeta);
  assert.deepEqual(await activeRoles(userId), ["SECRETARY"]);
  await boot();
  assert.deepEqual(await activeRoles(userId), ["SECRETARY"], "ACCOUNTANT révoqué reste révoqué");
});

test("révocation enregistrée sans resynchroniser users.role : jamais recréée au boot", { skip }, async () => {
  const userId = await insertLegacyUser({
    code: "USR-LEGACY-DESYNC",
    email: "legacy.desync@test.local",
    role: "Admin School",
    schoolId: schoolA,
  });
  await boot();
  assert.deepEqual(await activeRoles(userId), ["SCHOOL_ADMIN"]);
  // Révocation canonique (ex. donnée historique ou outil d'exploitation) sans
  // mise à jour du rôle primaire hérité : users.role vaut toujours Admin School.
  await pool.query(
    `UPDATE user_roles SET status = 'revoked', revoked_at = NOW()
     WHERE user_id = $1 AND role_key = 'SCHOOL_ADMIN' AND status = 'active'`,
    [userId],
  );
  await boot();
  assert.deepEqual(await activeRoles(userId), [], "SCHOOL_ADMIN révoqué jamais réattribué par users.role");
});

test("compte créé via l'API : révocation du dernier rôle puis boot", { skip }, async () => {
  const created = await store.createUser(
    { firstName: "Révo", lastName: "Cation", email: "api.revoke@test.local" },
    principalA,
    auditMeta,
  );
  await store.grantUserRole(created.id, { role: "Secrétaire" }, principalA, auditMeta);
  await store.revokeUserRole(created.id, { role: "Secrétaire" }, principalA, auditMeta);
  await boot();
  assert.deepEqual(await activeRoles(created.id), []);
});

test("nouvel octroi explicite après révocation : actif, unique, conservé au boot", { skip }, async () => {
  const userId = await insertLegacyUser({
    code: "USR-LEGACY-REGRANT",
    email: "legacy.regrant@test.local",
    role: "Comptable",
    secondaryRoles: ["Secrétaire"],
    schoolId: schoolA,
  });
  await boot();
  await store.revokeUserRole(userId, { role: "Secrétaire" }, principalA, auditMeta);
  await boot();
  assert.deepEqual(await activeRoles(userId), ["ACCOUNTANT"]);
  await store.grantUserRole(userId, { role: "Secrétaire" }, principalA, auditMeta);
  await boot();
  await boot();
  assert.deepEqual(await activeRoles(userId), ["ACCOUNTANT", "SECRETARY"]);
  assert.deepEqual(await roleHistory(userId, "SECRETARY"), ["revoked", "active"], "historique conservé, une seule ligne active");
});

test("isolation tenant : une révocation dans l'école A ne touche ni un autre compte ni l'école B", { skip }, async () => {
  const revokedInA = await insertLegacyUser({
    code: "USR-TENANT-A",
    email: "tenant.a@test.local",
    role: "Comptable",
    schoolId: schoolA,
  });
  const sameRoleInB = await insertLegacyUser({
    code: "USR-TENANT-B",
    email: "tenant.b@test.local",
    role: "Comptable",
    schoolId: schoolB,
  });
  await boot();
  await store.revokeUserRole(revokedInA, { role: "Comptable" }, principalA, auditMeta);
  await boot();
  assert.deepEqual(await activeRoles(revokedInA), []);
  assert.deepEqual(await activeRoles(sameRoleInB), ["ACCOUNTANT"], "compte de l'école B intact");
  assert.deepEqual(await effectiveRoleKeys(sameRoleInB, schoolB), ["ACCOUNTANT"]);
  assert.deepEqual(await effectiveRoleKeys(revokedInA, schoolA), []);
});

test("rôle plateforme (sans établissement) révoqué : jamais recréé au boot", { skip }, async () => {
  const userId = await insertLegacyUser({
    code: "USR-LEGACY-PLATFORM",
    email: "legacy.platform@test.local",
    role: "Admin Pays",
    schoolId: null,
  });
  await boot();
  assert.deepEqual(await activeRoles(userId), ["COUNTRY_ADMIN"]);
  await pool.query(
    `UPDATE user_roles SET status = 'revoked', revoked_at = NOW()
     WHERE user_id = $1 AND role_key = 'COUNTRY_ADMIN' AND school_id IS NULL AND status = 'active'`,
    [userId],
  );
  await boot();
  assert.deepEqual(await activeRoles(userId), [], "COUNTRY_ADMIN révoqué jamais réattribué");
});
