"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SUPABASE_DATA_API_LOCKDOWN_SQL,
  SENSITIVE_BUSINESS_TABLES,
} = require("../db/supabaseDataApiLockdown");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function main() {
  const sql = read("backend/db/migrations/20260904_p0_supabase_data_api_lockdown.sql");
  assert.equal(sql, SUPABASE_DATA_API_LOCKDOWN_SQL);
  assert.match(sql, /anon/);
  assert.match(sql, /authenticated/);
  assert.match(sql, /service_role/);
  assert.match(read("backend/db/postgresRepository.js"), /ensureSupabaseDataApiLockdown/);
  assert.match(read("docs/compliance/supabase-data-api-lockdown.md"), /Data API/);
  assert.equal(SENSITIVE_BUSINESS_TABLES.length >= 8, true);
  console.log("verify-supabase-data-api-lockdown (statique): SUCCESS");
}

main();
