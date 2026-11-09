"use strict";

/**
 * PERF-PR1 — base PostgreSQL jetable.
 * Aucun DROP SCHEMA. Une base déjà présente, ou sans marqueur de ce processus,
 * est refusée avant toute écriture destructive.
 */

const { randomBytes } = require("node:crypto");

const NAME_RE = /^somafrik_perf_pr1_[a-z0-9_]+$/;
const RESERVED = new Set([
  "postgres",
  "template0",
  "template1",
  "somafrik",
  "somafrik_pedagogy_it",
  "somafrik_finance_it",
  "perf",
]);

function refusal(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function databaseNameFromUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function assertDisposableDatabaseName(name, databaseUrl) {
  const normalized = String(name ?? "").trim();
  if (!NAME_RE.test(normalized) || RESERVED.has(normalized)) {
    throw refusal("PERF_PR1_DATABASE_REFUSED", "Nom de base jetable refusé.");
  }
  if (databaseUrl && databaseNameFromUrl(databaseUrl) === normalized) {
    throw refusal("PERF_PR1_DATABASE_REFUSED", "La base de connexion n'est pas une base jetable.");
  }
  return normalized;
}

function maintenanceUrl(databaseUrl) {
  return withDatabaseName(databaseUrl, "postgres");
}

function newDisposableName() {
  return `somafrik_perf_pr1_${process.pid}_${randomBytes(4).toString("hex")}`;
}

function loadPool(connectionString) {
  const { Pool } = require("pg");
  return new Pool({ connectionString });
}

async function createOwnedDisposableDatabase(databaseUrl, name = newDisposableName()) {
  const databaseName = assertDisposableDatabaseName(name, databaseUrl);
  const token = `${process.pid}:${randomBytes(8).toString("hex")}`;
  const admin = loadPool(maintenanceUrl(databaseUrl));
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (existing.rowCount) {
      throw refusal("PERF_PR1_DATABASE_EXISTS", "La base existe déjà et n'a pas été créée par ce processus.");
    }
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
  const pool = loadPool(withDatabaseName(databaseUrl, databaseName));
  try {
    await pool.query(
      `CREATE TABLE perf_pr1_disposable_marker (
         created_by text PRIMARY KEY,
         created_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    await pool.query("INSERT INTO perf_pr1_disposable_marker (created_by) VALUES ($1)", [token]);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    databaseName,
    connectionString: withDatabaseName(databaseUrl, databaseName),
    token,
    pool,
  };
}

async function assertOwnedDisposable(pool, databaseName, token) {
  const current = await pool.query("SELECT current_database() AS name");
  if (current.rows[0]?.name !== databaseName) {
    throw refusal("PERF_PR1_DATABASE_NOT_OWNED", "Connexion hors de la base jetable de ce processus.");
  }
  let marker;
  try {
    marker = await pool.query("SELECT created_by FROM perf_pr1_disposable_marker");
  } catch (error) {
    if (error?.code === "42P01") {
      throw refusal("PERF_PR1_DATABASE_NOT_OWNED", "Marqueur de base jetable absent pour ce processus.");
    }
    throw error;
  }
  if (marker.rowCount !== 1 || marker.rows[0].created_by !== token) {
    throw refusal("PERF_PR1_DATABASE_NOT_OWNED", "Marqueur de base jetable absent pour ce processus.");
  }
}

async function dropOwnedDisposableDatabase(databaseUrl, databaseName, token) {
  const name = assertDisposableDatabaseName(databaseName, databaseUrl);
  const pool = loadPool(withDatabaseName(databaseUrl, name));
  try {
    await assertOwnedDisposable(pool, name, token);
  } finally {
    await pool.end();
  }
  const admin = loadPool(maintenanceUrl(databaseUrl));
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await admin.query(`DROP DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

module.exports = {
  NAME_RE,
  assertDisposableDatabaseName,
  newDisposableName,
  createOwnedDisposableDatabase,
  assertOwnedDisposable,
  dropOwnedDisposableDatabase,
  withDatabaseName,
  maintenanceUrl,
};
