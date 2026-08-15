"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { CLIENTS_SCHEMA_SQL } = require("../db/clientsSchema");
const { USER_ROLES_SCHEMA_SQL } = require("../db/userRolesSchema");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { USER_ROLE_ERROR } = require("./userRoleLifecycle");
const userRoleLifecycleService = require("./userRoleLifecycleService");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_USER_ROLES_IT_DATABASE ?? "somafrik_user_roles_it")
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
  return {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
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
}

async function main() {
  if (!DATABASE_URL) {
    console.log("userRoleLifecycle.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await pool.query(CLIENTS_SCHEMA_SQL);
    await pool.query(USER_ROLES_SCHEMA_SQL);
    // Le SQL est rejoué au boot : il doit être strictement idempotent.
    await pool.query(USER_ROLES_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'Institut Kibwija', 'active')`,
      [country.rows[0].id],
    );
    const schoolRow = await pool.query(`SELECT id, short_code FROM schools WHERE school_code = 'CD-2026-0001'`);
    assert.equal(schoolRow.rows[0].short_code, "IK", "code court établissement dérivé une seule fois");

    const repo = createRepo(pool);
    const store = createClientsPgStore(repo);
    const principal = { role: "Admin School", schoolCode: "CD-2026-0001", identifier: "admin" };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "pg-lifecycle" };

    const created = await store.createUser(
      { firstName: "Grâce", lastName: "Kabeya", email: "grace.kabeya@test.local" },
      principal,
      auditMeta,
    );
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    assert.equal(created.publicId, "CD-IK-GK-26-00001");
    assert.equal(created.identityCode, "CD-IK-GK-26-00001");
    assert.equal(created.identifier, "GK-26-00001", "login court permanent exposé par le compte");
    assert.match(created.userCode, /^USR-\d{4}-\d{5}$/, "alias user_code legacy conservé");
    assert.equal(created.assignmentStatus, "Sans affectation");

    const row = await pool.query(
      `SELECT id, user_code, role, identity_code, login_code, identity_initials, identity_year, profile_payload
       FROM users WHERE id = $1`,
      [created.id],
    );
    assert.equal(row.rows[0].id, created.id);
    assert.equal(row.rows[0].user_code, created.userCode, "user_code legacy conservé comme alias de compatibilité");
    assert.equal(row.rows[0].role, null);
    assert.equal(row.rows[0].identity_initials, "GK");
    assert.equal(Number(row.rows[0].identity_year), 2026);
    assert.equal(row.rows[0].login_code, "GK-26-00001");
    assert.equal(row.rows[0].identity_code, "CD-IK-GK-26-00001");
    assert.equal(row.rows[0].profile_payload.identifier, "GK-26-00001");
    assert.equal(row.rows[0].profile_payload.identityCode, "CD-IK-GK-26-00001");

    await store.grantUserRole(created.id, { role: "Secrétaire" }, principal, auditMeta);
    assert.equal((await pool.query(`SELECT role FROM users WHERE id = $1`, [created.id])).rows[0].role, "SECRETARY");
    await store.grantUserRole(created.id, { role: "Enseignant" }, principal, auditMeta);
    assert.equal((await pool.query(`SELECT role FROM users WHERE id = $1`, [created.id])).rows[0].role, "SECRETARY");
    const stableAfterRoles = await pool.query(`SELECT identity_code, login_code FROM users WHERE id = $1`, [created.id]);
    assert.equal(stableAfterRoles.rows[0].identity_code, "CD-IK-GK-26-00001", "GRANT ne renumérote pas l'identité");
    assert.equal(stableAfterRoles.rows[0].login_code, "GK-26-00001");

    const roles = await pool.query(
      `SELECT role_key FROM user_roles WHERE user_id = $1 AND status = 'active' ORDER BY role_key`,
      [created.id],
    );
    assert.deepEqual(roles.rows.map((item) => item.role_key), ["SECRETARY", "TEACHER"]);
    const teachers = await pool.query(`SELECT COUNT(*)::int AS count FROM teachers WHERE user_id = $1`, [created.id]);
    assert.equal(teachers.rows[0].count, 1);

    const [raceA, raceB] = await Promise.allSettled([
      store.grantUserRole(created.id, { role: "Comptable" }, principal, auditMeta),
      store.grantUserRole(created.id, { role: "Comptable" }, principal, auditMeta),
    ]);
    const ok = [raceA, raceB].filter((item) => item.status === "fulfilled");
    const ko = [raceA, raceB].filter((item) => item.status === "rejected");
    assert.equal(ok.length, 1);
    assert.equal(ko.length, 1);
    assert.equal(ko[0].reason.code, USER_ROLE_ERROR.ROLE_ALREADY_GRANTED);
    const accountant = await pool.query(
      `SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = $1 AND role_key = 'ACCOUNTANT' AND status = 'active'`,
      [created.id],
    );
    assert.equal(accountant.rows[0].count, 1);
    assert.equal(
      (await pool.query(`SELECT role FROM users WHERE id = $1`, [created.id])).rows[0].role,
      "ACCOUNTANT",
      "plusieurs rôles → users.role = priorité canonique (ACCOUNTANT > SECRETARY > TEACHER)",
    );

    await store.revokeUserRole(created.id, { role: "Comptable" }, principal, auditMeta);
    assert.equal((await pool.query(`SELECT role FROM users WHERE id = $1`, [created.id])).rows[0].role, "SECRETARY");
    await store.revokeUserRole(created.id, { role: "Secrétaire" }, principal, auditMeta);
    assert.equal((await pool.query(`SELECT role FROM users WHERE id = $1`, [created.id])).rows[0].role, "TEACHER");
    await store.revokeUserRole(created.id, { role: "Enseignant" }, principal, auditMeta);
    assert.equal((await pool.query(`SELECT role FROM users WHERE id = $1`, [created.id])).rows[0].role, null);
    const leftoverAfterLast = await pool.query(
      `SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = $1 AND status = 'active'`,
      [created.id],
    );
    assert.equal(leftoverAfterLast.rows[0].count, 0);
    const stableAfterRevokes = await pool.query(`SELECT identity_code, login_code FROM users WHERE id = $1`, [created.id]);
    assert.equal(stableAfterRevokes.rows[0].identity_code, "CD-IK-GK-26-00001", "REVOKE ne renumérote pas l'identité");

    await store.updateUser(created.id, { lastName: "Mukendi" }, principal, auditMeta);
    const stableAfterRename = await pool.query(
      `SELECT identity_code, login_code, last_name FROM users WHERE id = $1`,
      [created.id],
    );
    assert.equal(stableAfterRename.rows[0].last_name, "Mukendi");
    assert.equal(stableAfterRename.rows[0].identity_code, "CD-IK-GK-26-00001", "changement de nom sans renumérotation");
    assert.equal(stableAfterRename.rows[0].login_code, "GK-26-00001");

    await assert.rejects(
      () => pool.query(`UPDATE users SET identity_code = 'CD-IK-HACK-26-99999' WHERE id = $1`, [created.id]),
      /PERMANENT_IDENTITY_IMMUTABLE/,
    );
    await assert.rejects(
      () => pool.query(`UPDATE schools SET short_code = 'ZZ' WHERE school_code = 'CD-2026-0001'`),
      /SCHOOL_SHORT_CODE_IMMUTABLE/,
    );

    const [codeA, codeB] = await Promise.all([
      store.createUser({ firstName: "A", lastName: "Un", email: "a.un@test.local" }, principal, auditMeta),
      store.createUser({ firstName: "B", lastName: "Deux", email: "b.deux@test.local" }, principal, auditMeta),
    ]);
    assert.notEqual(codeA.publicId, codeB.publicId);
    assert.notEqual(codeA.identifier, codeB.identifier);

    const concurrent = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        store.createUser(
          {
            firstName: "Grâce",
            lastName: "Kabeya",
            email: `concurrent.identity.${index}@test.local`,
          },
          principal,
          auditMeta,
        ),
      ),
    );
    assert.equal(new Set(concurrent.map((item) => item.identifier)).size, 100, "100 logins concurrents uniques");
    const concurrentRows = await pool.query(
      `SELECT identity_code, login_code FROM users WHERE email LIKE 'concurrent.identity.%@test.local'`,
    );
    assert.equal(concurrentRows.rowCount, 100);
    assert.equal(new Set(concurrentRows.rows.map((item) => item.identity_code)).size, 100);
    assert.equal(new Set(concurrentRows.rows.map((item) => item.login_code)).size, 100);

    const failStore = {
      ...store,
      withTransaction(fn) {
        return repo.withTransaction(async (tx) => {
          const bound = store.bind(tx);
          bound.recordClientsAudit = async () => {
            throw new Error("audit failed");
          };
          return fn(bound);
        });
      },
    };
    failStore.grantUserRole = (...args) => userRoleLifecycleService.grantRole(failStore, ...args);
    const isolated = await store.createUser(
      { firstName: "Audit", lastName: "Rollback", email: "audit.rollback@test.local" },
      principal,
      auditMeta,
    );
    await assert.rejects(
      () => failStore.grantUserRole(isolated.id, { role: "Secrétaire" }, principal, auditMeta),
      /audit failed/,
    );
    const leftover = await pool.query(
      `SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = $1 AND status = 'active'`,
      [isolated.id],
    );
    assert.equal(leftover.rows[0].count, 0, "rollback total si audit GRANT échoue");
    assert.equal(
      (await pool.query(`SELECT role FROM users WHERE id = $1`, [isolated.id])).rows[0].role,
      null,
      "users.role rollbacké avec user_roles si audit GRANT échoue",
    );

    await store.grantUserRole(isolated.id, { role: "Secrétaire" }, principal, auditMeta);
    assert.equal((await pool.query(`SELECT role FROM users WHERE id = $1`, [isolated.id])).rows[0].role, "SECRETARY");
    await assert.rejects(
      () => failStore.grantUserRole(isolated.id, { role: "Enseignant" }, principal, auditMeta),
      /audit failed/,
    );
    assert.equal(
      (await pool.query(`SELECT role FROM users WHERE id = $1`, [isolated.id])).rows[0].role,
      "SECRETARY",
      "users.role inchangé si GRANT suivant rollback",
    );
    assert.equal(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM user_roles WHERE user_id = $1 AND role_key = 'TEACHER' AND status = 'active'`,
          [isolated.id],
        )
      ).rows[0].count,
      0,
    );

    console.log("userRoleLifecycle.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
