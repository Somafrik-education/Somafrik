"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { USER_ROLES_SCHEMA_SQL } = require("../db/userRolesSchema");
const { createClientsPgStore } = require("../db/clientsPgStore");
const { createTxAdapter } = require("../db/txAdapter");
const { CLIENTS_ERROR } = require("./clientsManagement");
const clientsService = require("./clientsService");
const { ensureClientsCanonicalBootstrap } = require("../db/clientsCanonicalBootstrap");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_USER_PROVISION_IT_DATABASE ?? "somafrik_user_provision_it")
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
    console.log("clientsUserProvision.pg.test.js SKIP (DATABASE_URL absent)");
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

    const cd = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
    );
    const bi = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency)
       VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO schools (country_id, school_code, name, status, login_code)
       VALUES ($1, 'CD-2026-0001', 'Institut Bukavu', 'active', 'CD-IB-26-002'),
              ($2, 'BI-2026-0001', 'Ecole Kanyosha', 'active', 'BI-EK-26-001')`,
      [cd.rows[0].id, bi.rows[0].id],
    );
    const cdLogin = await pool.query(`SELECT login_code FROM schools WHERE school_code = 'CD-2026-0001'`);
    const cdLoginCode = String(cdLogin.rows[0]?.login_code ?? "").trim().toUpperCase();

    const repo = createRepo(pool);
    const store = createClientsPgStore(repo);
    const superAdmin = {
      role: "Super Administrateur Somafrik",
      schoolCode: "*",
      identifier: "superadmin",
    };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "pg-provision" };

    const countryAdmin = await store.provisionUser(
      {
        firstName: "Amina",
        lastName: "PaysBI",
        email: "amina.pays.bi.pg@test.local",
        temporaryPassword: "CountryAdminBI!2026",
        roleKey: "COUNTRY_ADMIN",
        countryCode: "BI",
      },
      superAdmin,
      auditMeta,
    );
    const countryPg = await pool.query(
      `SELECT u.id, u.school_id, u.role, ur.role_key, ur.school_id AS role_school_id, ur.status,
              u.profile_payload
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.role_key = 'COUNTRY_ADMIN'
        WHERE u.id = $1 AND ur.status = 'active' AND ur.revoked_at IS NULL`,
      [countryAdmin.id],
    );
    assert.equal(countryPg.rowCount, 1);
    assert.equal(countryPg.rows[0].school_id, null);
    assert.equal(countryPg.rows[0].role_school_id, null);
    assert.equal(countryPg.rows[0].status, "active");
    assert.equal(countryPg.rows[0].profile_payload?.countryCode, "BI");

    const schoolAdmin = await store.provisionUser(
      {
        firstName: "Grace",
        lastName: "Kanyosha",
        email: "grace.kanyosha.pg@test.local",
        temporaryPassword: "SchoolAdminBI!2026",
        roleKey: "SCHOOL_ADMIN",
        countryCode: "BI",
        schoolCode: "BI-2026-0001",
      },
      superAdmin,
      auditMeta,
    );
    const schoolPg = await pool.query(
      `SELECT u.school_id, s.school_code, c.iso_code, ur.school_id AS role_school_id, ur.role_key
         FROM users u
         JOIN schools s ON s.id = u.school_id
         JOIN countries c ON c.id = s.country_id
         JOIN user_roles ur ON ur.user_id = u.id AND ur.status = 'active'
        WHERE u.id = $1`,
      [schoolAdmin.id],
    );
    assert.equal(schoolPg.rowCount, 1);
    assert.equal(schoolPg.rows[0].school_code, "BI-2026-0001");
    assert.equal(schoolPg.rows[0].iso_code, "BI");
    assert.equal(schoolPg.rows[0].role_key, "SCHOOL_ADMIN");
    assert.equal(String(schoolPg.rows[0].school_id), String(schoolPg.rows[0].role_school_id));

    const schoolAdminCd = await store.provisionUser(
      {
        firstName: "Awa",
        lastName: "Bukavu",
        email: "awa.bukavu.pg@test.local",
        temporaryPassword: "SchoolAdminCD!2026",
        roleKey: "SCHOOL_ADMIN",
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
      },
      superAdmin,
      auditMeta,
    );
    assert.equal(schoolAdminCd.schoolCode, "CD-2026-0001");
    assert.equal(schoolAdminCd.countryCode, "CD");

    assert.ok(cdLoginCode, "login_code PostgreSQL manquant pour CD-2026-0001");
    const schoolAdminCdLogin = await store.provisionUser(
      {
        firstName: "Login",
        lastName: "Bukavu",
        email: "login.bukavu.pg@test.local",
        temporaryPassword: "SchoolAdminCD!2026",
        roleKey: "SCHOOL_ADMIN",
        countryCode: "CD",
        schoolCode: cdLoginCode,
      },
      superAdmin,
      auditMeta,
    );
    assert.equal(schoolAdminCdLogin.schoolCode, "CD-2026-0001");
    assert.notEqual(schoolAdminCdLogin.schoolCode, cdLoginCode);

    const schoolAdminCdAccent = await store.provisionUser(
      {
        firstName: "Accent",
        lastName: "Congo",
        email: "accent.congo.pg@test.local",
        temporaryPassword: "SchoolAdminCD!2026",
        roleKey: "SCHOOL_ADMIN",
        countryScope: "République Démocratique du Congo",
        schoolCode: "CD-2026-0001",
      },
      superAdmin,
      auditMeta,
    );
    assert.equal(schoolAdminCdAccent.countryCode, "CD");

    await assert.rejects(
      () =>
        store.provisionUser(
          {
            firstName: "Wrong",
            lastName: "Scope",
            email: "wrong.scope.pg@test.local",
            roleKey: "SCHOOL_ADMIN",
            countryCode: "BI",
            schoolCode: "CD-2026-0001",
          },
          superAdmin,
          auditMeta,
        ),
      (error) => error.statusCode === 409 && error.code === CLIENTS_ERROR.SCHOOL_COUNTRY_MISMATCH,
    );

    await assert.rejects(
      () =>
        store.provisionUser(
          {
            firstName: "No",
            lastName: "Country",
            email: "no.country.pg@test.local",
            roleKey: "SCHOOL_ADMIN",
            schoolCode: "CD-2026-0001",
          },
          superAdmin,
          auditMeta,
        ),
      (error) => error.statusCode === 400 && error.code === CLIENTS_ERROR.COUNTRY_REQUIRED,
    );

    const leftoverMismatch = await pool.query(`SELECT id FROM users WHERE email = 'wrong.scope.pg@test.local'`);
    assert.equal(leftoverMismatch.rowCount, 0);

    const roleFailStore = {
      ...store,
      withTransaction(fn) {
        return repo.withTransaction(async (tx) => {
          const bound = store.bind(tx);
          bound.insertUserRole = async () => {
            throw new Error("forced user_roles failure");
          };
          return fn(bound);
        });
      },
    };
    roleFailStore.provisionUser = (...args) => clientsService.provisionUser(roleFailStore, ...args);
    await assert.rejects(
      () =>
        roleFailStore.provisionUser(
          {
            firstName: "Rollback",
            lastName: "Role",
            email: "rollback.role.pg@test.local",
            roleKey: "COUNTRY_ADMIN",
            countryCode: "BI",
          },
          superAdmin,
          auditMeta,
        ),
      (error) => error.code === CLIENTS_ERROR.USER_ROLE_GRANT_FAILED,
    );
    const leftoverUser = await pool.query(`SELECT id FROM users WHERE email = 'rollback.role.pg@test.local'`);
    assert.equal(leftoverUser.rowCount, 0, "rollback insert user_roles : aucune ligne users");

    const auditFailStore = {
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
    auditFailStore.provisionUser = (...args) => clientsService.provisionUser(auditFailStore, ...args);
    await assert.rejects(
      () =>
        auditFailStore.provisionUser(
          {
            firstName: "Rollback",
            lastName: "Audit",
            email: "rollback.audit.pg@test.local",
            roleKey: "SCHOOL_ADMIN",
            countryCode: "BI",
            schoolCode: "BI-2026-0001",
          },
          superAdmin,
          auditMeta,
        ),
      /audit failed/,
    );
    const leftoverAuditUser = await pool.query(`SELECT id FROM users WHERE email = 'rollback.audit.pg@test.local'`);
    assert.equal(leftoverAuditUser.rowCount, 0, "rollback audit : aucune ligne users");
    const leftoverAuditRole = await pool.query(
      `SELECT ur.id FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE u.email = 'rollback.audit.pg@test.local'`,
    );
    assert.equal(leftoverAuditRole.rowCount, 0, "rollback audit : aucune ligne user_roles");

    console.log("clientsUserProvision.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
