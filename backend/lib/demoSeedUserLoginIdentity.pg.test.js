"use strict";

/**
 * RED/GREEN — boot officiel PostgreSQL + seed démo.
 *
 * Reproduction P0 audit #748 :
 *   base neuve → init schéma → seed démo officiel → 23505 / uq_users_school_email
 *
 * Avant correctif : repo.init() lève PostgreSQL 23505 (contrainte uq_users_school_email).
 * Après correctif : boot + second boot sans violation, aucun doublon school_id+email.
 *
 * Hors périmètre : bootstrap-e2e-superadmin, backoffice_state, E2E métier.
 */

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");
const {
  COUNT_SCHOOL_EMAIL_DUPLICATE_GROUPS_SQL,
} = require("./usersLoginIdentity");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_DEMO_SEED_IT_DATABASE ?? "somafrik_demo_seed_uniqueness_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");
const SKIP_IT_DATABASE = String(
  process.env.SOMAFRIK_DEMO_SEED_SKIP_IT_DATABASE ?? "somafrik_demo_seed_skip_it",
)
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function recreateIsolatedDatabase(databaseUrl, databaseName) {
  const maintenance = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await maintenance.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (existing.rowCount) {
      await maintenance.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await maintenance.query(`DROP DATABASE ${databaseName}`);
    }
    await maintenance.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await maintenance.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

async function inventoryUsers(connectionString) {
  const pool = new Pool({ connectionString });
  try {
    const duplicates = await pool.query(COUNT_SCHOOL_EMAIL_DUPLICATE_GROUPS_SQL);
    const rows = await pool.query(
      `SELECT s.school_code,
              u.role,
              lower(trim(u.email)) AS email_normalized,
              COUNT(*)::int AS count
       FROM users u
       LEFT JOIN schools s ON s.id = u.school_id
       WHERE u.email IS NOT NULL AND trim(u.email) <> ''
         AND COALESCE(u.status, 'active') NOT IN ('deleted', 'archived')
       GROUP BY s.school_code, u.role, lower(trim(u.email))
       ORDER BY s.school_code NULLS FIRST, u.role, email_normalized`,
    );
    return {
      duplicateGroups: Number(duplicates.rows[0]?.duplicate_groups ?? 0),
      inventory: rows.rows,
    };
  } finally {
    await pool.end();
  }
}

function assertOfficialSeedSuccess(error) {
  if (!error) return;
  const code = String(error.code ?? "");
  const constraint = String(error.constraint ?? "");
  if (code === "23505" && constraint.includes("uq_users_school_email")) {
    throw error;
  }
  throw error;
}

async function bootOfficialSeed(connectionString) {
  const previousSkip = process.env.SOMAFRIK_SKIP_DEMO_SEED;
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "false";
  const repo = createPostgresRepository(connectionString);
  try {
    await repo.init();
  } catch (error) {
    assertOfficialSeedSuccess(error);
  } finally {
    await repo.close();
    if (previousSkip === undefined) {
      delete process.env.SOMAFRIK_SKIP_DEMO_SEED;
    } else {
      process.env.SOMAFRIK_SKIP_DEMO_SEED = previousSkip;
    }
  }
}

async function bootSkipSeed(connectionString) {
  const previousSkip = process.env.SOMAFRIK_SKIP_DEMO_SEED;
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  const repo = createPostgresRepository(connectionString);
  try {
    await repo.init();
  } finally {
    await repo.close();
    if (previousSkip === undefined) {
      delete process.env.SOMAFRIK_SKIP_DEMO_SEED;
    } else {
      process.env.SOMAFRIK_SKIP_DEMO_SEED = previousSkip;
    }
  }
}

async function main() {
  if (!DATABASE_URL) {
    console.log("demoSeedUserLoginIdentity.pg.test.js: SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await recreateIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  await bootOfficialSeed(isolatedUrl);

  const first = await inventoryUsers(isolatedUrl);
  assert.equal(first.duplicateGroups, 0, "aucun doublon school_id + email après seed officiel");
  assert.ok(first.inventory.length > 0, "le seed officiel doit créer des comptes users");
  assert.ok(
    first.inventory.some((row) => row.role === "PARENT" && row.email_normalized === "parent.dupont@example.com"),
    "le parent démo conserve parent.dupont@example.com",
  );
  assert.equal(
    first.inventory.filter((row) => row.email_normalized === "parent.dupont@example.com").length,
    1,
    "parent.dupont@example.com n'est porté que par un compte",
  );

  await bootOfficialSeed(isolatedUrl);
  const second = await inventoryUsers(isolatedUrl);
  assert.equal(second.duplicateGroups, 0, "second boot : aucun doublon school_id + email");
  assert.equal(second.inventory.length, first.inventory.length, "second boot : pas de users supplémentaires");

  const skipUrl = await recreateIsolatedDatabase(DATABASE_URL, SKIP_IT_DATABASE);
  await bootSkipSeed(skipUrl);
  const skipped = await inventoryUsers(skipUrl);
  assert.equal(skipped.duplicateGroups, 0, "skip-demo-seed : aucun doublon");
  assert.equal(
    skipped.inventory.some((row) => row.email_normalized === "parent.dupont@example.com"),
    false,
    "skip-demo-seed : le parent démo n'est pas créé",
  );

  console.log("demoSeedUserLoginIdentity.pg.test.js OK");
  console.log(
    JSON.stringify(
      {
        officialUsers: first.inventory.length,
        secondBootUsers: second.inventory.length,
        skipDemoUsers: skipped.inventory.length,
        inventory: first.inventory,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("demoSeedUserLoginIdentity.pg.test.js FAIL");
  console.error({
    code: error.code,
    constraint: error.constraint,
    detail: error.detail,
    message: error.message,
  });
  process.exit(1);
});
