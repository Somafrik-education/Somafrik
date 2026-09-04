"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SUPABASE_DATA_API_LOCKDOWN_SQL,
  SENSITIVE_BUSINESS_TABLES,
  LOCKDOWN_GRANTEES,
} = require("../db/supabaseDataApiLockdown");

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION = path.join(ROOT, "backend/db/migrations/20260904_p0_supabase_data_api_lockdown.sql");

test("P0-1 : migration idempotente révoque anon / authenticated / PUBLIC", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  assert.equal(sql, SUPABASE_DATA_API_LOCKDOWN_SQL);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I/);
  assert.match(sql, /REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I/);
  assert.match(sql, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I/);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC/);
  assert.match(sql, /GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role/);
  assert.match(sql, /Ne touche pas service_role/);
  assert.doesNotMatch(sql, /REVOKE[^\n]*service_role/);
});

test("P0-1 : tables métier sensibles couvertes par le gate", () => {
  for (const table of [
    "users",
    "students",
    "teachers",
    "contacts",
    "payments",
    "audit_logs",
    "sessions",
    "mobile_push_devices",
  ]) {
    assert.ok(SENSITIVE_BUSINESS_TABLES.includes(table), table);
  }
  assert.deepEqual([...LOCKDOWN_GRANTEES].sort(), ["PUBLIC", "anon", "authenticated"].sort());
});

test("P0-1 : aucun client Supabase Data API dans Web/Mobile/backend applicatif", () => {
  const deny = ["@supabase/supabase-js", "createClient("];
  const roots = [
    path.join(ROOT, "web/src"),
    path.join(ROOT, "Mobile/src"),
    path.join(ROOT, "backend"),
  ];
  const skipDir = new Set(["node_modules", "dist", "coverage"]);
  const hits = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipDir.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!/\.(js|ts|tsx|mjs|cjs)$/.test(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(ROOT, full);
      if (rel.includes("supabaseDataApiLockdown")) continue;
      const src = fs.readFileSync(full, "utf8");
      if (src.includes("@supabase/supabase-js") || /from ['\"]@supabase/.test(src)) {
        hits.push(rel);
      }
    }
  }

  for (const root of roots) walk(root);
  assert.deepEqual(hits, [], `client Supabase interdit: ${hits.join(", ")}`);
  void deny;
});
