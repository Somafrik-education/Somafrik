"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { PostgresRepository } = require("../db/postgresRepository");
const { USER_ROLES_MIGRATION_AMBIGUOUS } = require("../db/userRolesSchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_USER_ROLES_MIGRATION_IT_DATABASE ?? "somafrik_user_roles_migration_it")
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

function createEnsureAdapter(pool) {
  return {
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    query: (sql, params) => pool.query(sql, params),
  };
}

async function applyUserRolesCanonical(pool) {
  await PostgresRepository.prototype.ensureUserRolesCanonicalSchema.call(createEnsureAdapter(pool));
}

async function seedCountryAndSchools(pool) {
  const country = await pool.query(
    `INSERT INTO countries (name, iso_code, phone_code, currency)
     VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id`,
  );
  const countryId = country.rows[0].id;
  const schoolA = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'CD-2026-0001', 'Kin', 'active') RETURNING id`,
    [countryId],
  );
  const schoolB = await pool.query(
    `INSERT INTO schools (country_id, school_code, name, status)
     VALUES ($1, 'BI-2026-0002', 'Buj', 'active') RETURNING id`,
    [countryId],
  );
  return { schoolA: schoolA.rows[0].id, schoolB: schoolB.rows[0].id };
}

async function insertUser(pool, { schoolId, userCode, firstName, lastName, role }) {
  const result = await pool.query(
    `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id, user_code, role`,
    [schoolId, userCode, firstName, lastName, role],
  );
  return result.rows[0];
}

async function main() {
  if (!DATABASE_URL) {
    console.log("userRolesMigration.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const url = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    const schema = fs.readFileSync(path.join(__dirname, "../db/schema.sql"), "utf8");
    await pool.query(schema);

    await applyUserRolesCanonical(pool);
    await applyUserRolesCanonical(pool);

    const indexes = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('user_roles_active_school_unique', 'user_roles_active_platform_unique')
       ORDER BY indexname`,
    );
    assert.equal(indexes.rowCount, 2, "index uniques actifs présents après rerun");

    const { schoolA, schoolB } = await seedCountryAndSchools(pool);
    const teacher = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00001",
      firstName: "Fatou",
      lastName: "Sow",
      role: "Enseignant",
    });
    const unaffect = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00002",
      firstName: "Marie",
      lastName: "Kabeya",
      role: null,
    });
    const otherTenant = await insertUser(pool, {
      schoolId: schoolB,
      userCode: "USR-2026-00003",
      firstName: "Jean",
      lastName: "Ndaye",
      role: "Secrétaire",
    });
    const ambiguous = await insertUser(pool, {
      schoolId: schoolA,
      userCode: "USR-2026-00004",
      firstName: "Role",
      lastName: "Inconnu",
      role: "Wizard",
    });

    await pool.query(`DELETE FROM user_roles`);
    await assert.rejects(
      () => applyUserRolesCanonical(pool),
      (error) => error.code === USER_ROLES_MIGRATION_AMBIGUOUS,
      "rôle legacy ambigu → USER_ROLES_MIGRATION_AMBIGUOUS",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM users`)).rows[0].count,
      4,
      "aucun compte perdu sur ambiguïté",
    );
    assert.equal(
      (await pool.query(`SELECT COUNT(*)::int AS count FROM user_roles`)).rows[0].count,
      0,
      "aucun backfill si inventaire fail-closed",
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [ambiguous.id]);
    await applyUserRolesCanonical(pool);
    await applyUserRolesCanonical(pool);

    const backfilled = await pool.query(
      `SELECT user_id, school_id, role_key, status
       FROM user_roles
       WHERE status = 'active'
       ORDER BY role_key, user_id`,
    );
    assert.equal(backfilled.rowCount, 2);
    const byUser = Object.fromEntries(
      backfilled.rows.map((row) => [row.user_id, row]),
    );
    assert.equal(byUser[teacher.id].role_key, "TEACHER");
    assert.equal(String(byUser[teacher.id].school_id), String(schoolA));
    assert.equal(byUser[otherTenant.id].role_key, "SECRETARY");
    assert.equal(String(byUser[otherTenant.id].school_id), String(schoolB));
    assert.equal(
      backfilled.rows.some((row) => String(row.user_id) === String(unaffect.id)),
      false,
      "utilisateur sans rôle : aucune ligne user_roles",
    );

    const usersAfter = await pool.query(`SELECT id FROM users ORDER BY user_code`);
    assert.deepEqual(
      usersAfter.rows.map((row) => row.id),
      [teacher.id, unaffect.id, otherTenant.id],
    );

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO user_roles (user_id, school_id, role_key, status)
           VALUES ($1, $2, 'TEACHER', 'active')`,
          [teacher.id, schoolA],
        ),
      /user_roles_active_school_unique/,
    );

    console.log("userRolesMigration.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
