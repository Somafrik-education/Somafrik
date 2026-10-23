"use strict";

/**
 * SEC-TENANT-01 — isUserAttachedToSchool (PostgreSQL) : base du contrôle de
 * rattachement au refresh JWT. Établissement principal ou rôle actif uniquement.
 */

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_sec_tenant_01_it";

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function resetIsolatedDatabase() {
  const admin = new Pool({ connectionString: withDatabaseName(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = withDatabaseName(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  return url;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("secTenant01RefreshAttachment.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  const url = await resetIsolatedDatabase();
  const repo = createPostgresRepository(url);
  const pool = new Pool({ connectionString: url });
  try {
    await repo.init();
    const country = await pool.query(
      `INSERT INTO countries (name, iso_code, phone_code, currency, is_active)
       VALUES ('RDC', 'CD', '+243', 'CDF', TRUE)
       ON CONFLICT (iso_code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );
    const insertSchool = (code, shortCode, name) =>
      pool.query(
        `INSERT INTO schools (country_id, school_code, short_code, name, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [country.rows[0].id, code, shortCode, name],
      );
    const schoolA = (await insertSchool("CD-2026-0901", "STA", "Institut Sec A")).rows[0].id;
    const schoolB = (await insertSchool("CD-2026-0902", "STB", "Institut Sec B")).rows[0].id;
    const user = (
      await pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name, role, status)
         VALUES ($1, 'SEC-T01-U1', 'Sara', 'Kisa', 'Secrétaire', 'active') RETURNING id`,
        [schoolA],
      )
    ).rows[0].id;

    assert.equal(await repo.isUserAttachedToSchool(user, schoolA), true, "établissement principal");
    assert.equal(await repo.isUserAttachedToSchool(user, schoolB), false, "autre établissement");
    assert.equal(await repo.isUserAttachedToSchool(user, null), false, "session sans établissement");
    assert.equal(await repo.isUserAttachedToSchool("not-a-uuid", schoolA), false, "identifiant invalide");

    await pool.query(
      `INSERT INTO user_roles (user_id, school_id, role_key, status) VALUES ($1, $2, 'SECRETARY', 'active')`,
      [user, schoolB],
    );
    assert.equal(await repo.isUserAttachedToSchool(user, schoolB), true, "rôle actif dans B");

    await pool.query(
      `UPDATE user_roles SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1 AND school_id = $2`,
      [user, schoolB],
    );
    assert.equal(await repo.isUserAttachedToSchool(user, schoolB), false, "rôle révoqué dans B");

    await pool.query(`UPDATE users SET school_id = NULL WHERE id = $1`, [user]);
    assert.equal(await repo.isUserAttachedToSchool(user, schoolA), false, "retrait de l'établissement principal");

    console.log("secTenant01RefreshAttachment.pg.test.js: 8/8 PASS");
  } finally {
    await pool.end();
    if (typeof repo.close === "function") await repo.close();
    else if (repo.pool?.end) await repo.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
