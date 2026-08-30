"use strict";

/**
 * Exécute une suite de tests dans une base PostgreSQL éphémère, locale et
 * canonical-bootstrapped. Aucun accès réseau vers une base de préproduction
 * n'est accepté par ce harnais.
 *
 * Usage:
 *   node backend/scripts/run-isolated-test-suite.js npm run verify:planning-v2-weekly
 */
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../db/repositoryFactory");

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function parseLocalTestDatabaseUrl(rawUrl) {
  const text = String(rawUrl ?? "").trim();
  if (!text) {
    throw new Error("DATABASE_URL est requis pour l'isolation PostgreSQL CI.");
  }

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("DATABASE_URL invalide pour l'isolation PostgreSQL CI.");
  }

  if (!/^postgres(ql)?:$/i.test(parsed.protocol)) {
    throw new Error("Le harnais d'isolation accepte uniquement PostgreSQL.");
  }
  if (!LOCAL_DATABASE_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Base de test non locale refusée (${parsed.hostname || "hôte absent"}). ` +
        "Les gates CI ne doivent jamais dépendre d'une base de préproduction.",
    );
  }
  if (!String(parsed.pathname ?? "").replace(/^\//, "").trim()) {
    throw new Error("DATABASE_URL doit cibler une base locale explicite.");
  }
  return parsed;
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(String(databaseUrl));
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sanitizeDatabaseToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
}

function buildIsolatedDatabaseName(env = process.env) {
  const run = sanitizeDatabaseToken(env.GITHUB_RUN_ID || env.CI_PIPELINE_ID || "local");
  const job = sanitizeDatabaseToken(env.GITHUB_JOB || "suite");
  const nonce = randomBytes(4).toString("hex");
  const base = ["somafrik_ci", run, job, process.pid, nonce].filter(Boolean).join("_");
  return base.slice(0, 63);
}

async function withMaintenancePool(databaseUrl, callback) {
  const maintenanceUrl = withDatabaseName(databaseUrl, "postgres");
  const pool = new Pool({ connectionString: maintenanceUrl, max: 1 });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function createIsolatedDatabase(databaseUrl, databaseName) {
  await withMaintenancePool(databaseUrl, async (pool) => {
    await pool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)} TEMPLATE template0`);
  });
}

async function dropIsolatedDatabase(databaseUrl, databaseName) {
  await withMaintenancePool(databaseUrl, async (pool) => {
    await pool.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await pool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  });
}

async function bootstrapCanonicalSchema(isolatedUrl) {
  process.env.DATABASE_URL = isolatedUrl;
  process.env.NODE_ENV = "test";
  process.env.SOMAFRIK_DB_REQUIRED = "true";
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";

  const repository = createPostgresRepository(isolatedUrl, process.env);
  try {
    await repository.init();
  } finally {
    await repository.pool.end();
  }
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Suite interrompue par le signal ${signal}.`));
        return;
      }
      resolve(Number.isInteger(code) ? code : 1);
    });
  });
}

async function runIsolatedSuite(argv = process.argv.slice(2), env = process.env) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("Commande de suite absente.");
  }

  const sourceUrl = String(env.DATABASE_URL ?? "").trim();
  parseLocalTestDatabaseUrl(sourceUrl);
  const databaseName = buildIsolatedDatabaseName(env);
  const isolatedUrl = withDatabaseName(sourceUrl, databaseName);

  await createIsolatedDatabase(sourceUrl, databaseName);
  try {
    await bootstrapCanonicalSchema(isolatedUrl);
    const childEnv = {
      ...env,
      DATABASE_URL: isolatedUrl,
      NODE_ENV: "test",
      SOMAFRIK_DB_REQUIRED: "true",
      SOMAFRIK_SKIP_DEMO_SEED: "true",
      SOMAFRIK_TEST_DB_ISOLATED: "true",
      SOMAFRIK_TEST_DB_NAME: databaseName,
    };
    console.log(`[test-db] suite isolée: ${databaseName}`);
    const exitCode = await runCommand(argv[0], argv.slice(1), childEnv);
    if (exitCode !== 0) {
      const error = new Error(`Suite en échec (code ${exitCode}).`);
      error.exitCode = exitCode;
      throw error;
    }
  } finally {
    await dropIsolatedDatabase(sourceUrl, databaseName);
    console.log(`[test-db] cleanup terminé: ${databaseName}`);
  }
}

if (require.main === module) {
  runIsolatedSuite().catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
  });
}

module.exports = {
  LOCAL_DATABASE_HOSTS,
  parseLocalTestDatabaseUrl,
  withDatabaseName,
  quoteIdentifier,
  buildIsolatedDatabaseName,
  createIsolatedDatabase,
  dropIsolatedDatabase,
  bootstrapCanonicalSchema,
  runIsolatedSuite,
};
