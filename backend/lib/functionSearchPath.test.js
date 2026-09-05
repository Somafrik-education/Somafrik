"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  FUNCTION_SEARCH_PATH_SQL,
  MUTABLE_SEARCH_PATH_PROBE_SQL,
} = require("../db/functionSearchPath");

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION = path.join(ROOT, "backend/db/migrations/20260905_p1_function_search_path.sql");

test("search_path : migration versionnée, pas de btree_gist", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  assert.equal(sql, FUNCTION_SEARCH_PATH_SQL);
  const executable = sql.replace(/^--.*$/gm, "");
  assert.match(sql, /SET search_path TO pg_catalog, public, pg_temp/);
  assert.match(sql, /deptype = 'e'/);
  assert.match(sql, /gist_%/);
  assert.match(sql, /gbt_%/);
  assert.doesNotMatch(executable, /ALTER EXTENSION/);
  assert.doesNotMatch(executable, /btree_gist/);
  assert.match(sql, /nspname = 'public'/);
  assert.match(MUTABLE_SEARCH_PATH_PROBE_SQL, /search_path=%/);
});

test("search_path : boot PostgreSQL applique la migration en dernier", () => {
  const src = fs.readFileSync(path.join(ROOT, "backend/db/postgresRepository.js"), "utf8");
  assert.match(src, /ensureFunctionSearchPath/);
  const lockdown = src.indexOf("ensureSupabaseDataApiLockdown");
  const searchPath = src.indexOf("ensureFunctionSearchPath");
  assert.ok(lockdown > 0 && searchPath > lockdown, "search_path après le lockdown Data API");
});

test("search_path : CREATE applicatifs chauds portent SET search_path", () => {
  const school = fs.readFileSync(path.join(ROOT, "backend/db/schoolSettingsSchema.js"), "utf8");
  const comms = fs.readFileSync(path.join(ROOT, "backend/db/communicationsNotificationsSchema.js"), "utf8");
  const roles = fs.readFileSync(path.join(ROOT, "backend/db/userRolesSchema.js"), "utf8");
  assert.match(school, /SET search_path TO pg_catalog, public, pg_temp/);
  assert.match(comms, /SET search_path TO pg_catalog, public, pg_temp/);
  assert.match(roles, /SET search_path TO pg_catalog, public, pg_temp/);
});
