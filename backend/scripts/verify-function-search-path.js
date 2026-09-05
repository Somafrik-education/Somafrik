"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FUNCTION_SEARCH_PATH_SQL } = require("../db/functionSearchPath");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function main() {
  const sql = read("backend/db/migrations/20260905_p1_function_search_path.sql");
  assert.equal(sql, FUNCTION_SEARCH_PATH_SQL);
  assert.match(sql, /SET search_path TO pg_catalog, public, pg_temp/);
  const executable = sql.replace(/^--.*$/gm, "");
  assert.doesNotMatch(executable, /ALTER EXTENSION/);
  assert.doesNotMatch(executable, /btree_gist/);
  assert.match(read("backend/db/postgresRepository.js"), /ensureFunctionSearchPath/);
  assert.match(read("backend/db/schoolSettingsSchema.js"), /SET search_path TO pg_catalog, public, pg_temp/);
  console.log("verify-function-search-path (statique): SUCCESS");
}

main();
