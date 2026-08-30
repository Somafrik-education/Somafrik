"use strict";

/**
 * Intégration PostgreSQL — POST create-teacher atomique.
 * user + user_roles(TEACHER) + teachers + audit_logs = un seul COMMIT.
 * Un échec GRANT/profil après insert user rollback les quatre tables.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { PostgresRepository } = require("../db/postgresRepository");
const { createTxAdapter } = require("../db/txAdapter");
const { USER_ROLES_SCHEMA_SQL } = require("../db/userRolesSchema");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");
const { USER_ROLE_ERROR } = require("./userRoleLifecycle");
const { createTeacherIdentityFromUsers } = require("./createTeacherIdentityFromUsers");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_CREATE_TEACHER_IT_DATABASE ?? "somafrik_create_teacher_it")
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

function createRepository(pool) {
  const repo = {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = createTxAdapter(client);
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (_rollbackError) {
          // conserve l'erreur métier
        }
        throw error;
      } finally {
        client.release();
      }
    },
    createTxScope(tx) {
      return PostgresRepository.prototype.createTxScope.call(this, tx);
    },
    createTransactionalClientsStore(tx) {
      return createClientsPgStore(this.createTxScope(tx));
    },
  };
  return repo;
}

async function counts(pool) {
  const [users, roles, teachers, audits] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM users`),
    pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`),
    pool.query(`SELECT COUNT(*)::int AS count FROM teachers`),
    pool.query(`SELECT COUNT(*)::int AS count FROM audit_logs`),
  ]);
  return {
    users: users.rows[0].count,
    user_roles: roles.rows[0].count,
    teachers: teachers.rows[0].count,
    audit_logs: audits.rows[0].count,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("createTeacherIdentityFromUsers.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);
    await ensureClientsCanonicalBootstrap(pool, { info() {}, error() {} });
    await pool.query(USER_ROLES_SCHEMA_SQL);

    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name, status)
       VALUES ($1, 'CD-2026-0001', 'CD-IK-26-001', 'Institut Kibwija', 'active')`,
      [country.rows[0].id],
    );
    const schoolLogin = (
      await pool.query(`SELECT COALESCE(login_code, 'CD-IK-26-001') AS login_code FROM schools WHERE school_code = 'CD-2026-0001'`)
    ).rows[0].login_code;

    const repository = createRepository(pool);
    const principal = { role: "Admin School", schoolCode: schoolLogin, identifier: "admin" };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "pg-create-teacher-atomic" };
    const civil = {
      firstName: "Awa",
      lastName: "Ndiaye",
      birthDate: "1990-05-01",
      gender: "F",
    };

    const created = await createTeacherIdentityFromUsers(
      repository,
      {
        ...civil,
        email: "awa.one@test.local",
        phone: "+243811000001",
        temporaryPassword: "TempPass12",
      },
      principal,
      auditMeta,
    );
    assert.ok(created.user?.id);
    assert.ok(created.credentials?.login);
    assert.equal(created.credentials.temporarySecret, "TempPass12");
    assert.ok((created.user.roleKeys ?? []).includes("TEACHER"));

    const afterSuccess = await counts(pool);
    assert.equal(afterSuccess.users, 1);
    assert.equal(afterSuccess.user_roles, 1);
    assert.equal(afterSuccess.teachers, 1);
    assert.ok(afterSuccess.audit_logs >= 2, "create_user + grant_role audités");

    await assert.rejects(
      () =>
        createTeacherIdentityFromUsers(
          repository,
          {
            ...civil,
            email: "awa.two@test.local",
            phone: "+243811000002",
            temporaryPassword: "TempPass12",
          },
          principal,
          auditMeta,
        ),
      (error) => error.code === USER_ROLE_ERROR.TEACHER_PROFILE_AMBIGUOUS,
    );

    const afterFailure = await counts(pool);
    assert.deepEqual(afterFailure, afterSuccess, "ROLLBACK : users / user_roles / teachers / audit_logs inchangés");
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE email = 'awa.two@test.local'`)).rows[0].count,
      0,
      "aucune nouvelle ligne users",
    );
    assert.equal(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM user_roles ur
           JOIN users u ON u.id = ur.user_id
           WHERE u.email = 'awa.two@test.local'`,
        )
      ).rows[0].count,
      0,
      "aucune nouvelle ligne user_roles",
    );
    assert.equal(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM teachers t
           JOIN users u ON u.id = t.user_id
           WHERE u.email = 'awa.two@test.local'`,
        )
      ).rows[0].count,
      0,
      "aucune nouvelle ligne teachers",
    );
    assert.equal(
      (
        await pool.query(
          `SELECT COUNT(*)::int AS count FROM audit_logs
           WHERE new_value::text LIKE '%awa.two@test.local%'
              OR old_value::text LIKE '%awa.two@test.local%'`,
        )
      ).rows[0].count,
      0,
      "aucun audit partiel",
    );

    console.log("createTeacherIdentityFromUsers.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
