"use strict";

const fs = require("fs");
const path = require("path");

const SUPABASE_DATA_API_LOCKDOWN_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260904_p0_supabase_data_api_lockdown.sql"),
  "utf8",
);

const SENSITIVE_BUSINESS_TABLES = Object.freeze([
  "users",
  "students",
  "teachers",
  "contacts",
  "payments",
  "audit_logs",
  "sessions",
  "mobile_push_devices",
]);

const DATA_API_PRIVILEGES = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]);
const LOCKDOWN_GRANTEES = Object.freeze(["anon", "authenticated", "PUBLIC"]);

const EXPOSED_FUNCTION_INVENTORY_SQL = `
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  CASE p.prosecdef WHEN TRUE THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security,
  p.proacl::text AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname`;

const EXPOSED_VIEW_INVENTORY_SQL = `
SELECT
  n.nspname AS schema_name,
  c.relname AS view_name,
  CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' ELSE c.relkind::text END AS kind,
  c.relacl::text AS acl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v', 'm')
ORDER BY c.relname`;

const SENSITIVE_GRANT_PROBE_SQL = `
SELECT
  table_schema,
  table_name,
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = ANY($1::text[])
  AND privilege_type = ANY($2::text[])
  AND grantee = ANY($3::text[])
ORDER BY table_name, grantee, privilege_type`;

async function applySupabaseDataApiLockdown(executor) {
  if (!executor || typeof executor.query !== "function") {
    throw new Error("applySupabaseDataApiLockdown: executor.query requis");
  }
  await executor.query(SUPABASE_DATA_API_LOCKDOWN_SQL);
}

async function listSensitiveDataApiGrants(executor, tables = SENSITIVE_BUSINESS_TABLES) {
  const result = await executor.query(SENSITIVE_GRANT_PROBE_SQL, [
    tables,
    DATA_API_PRIVILEGES,
    LOCKDOWN_GRANTEES,
  ]);
  return result.rows ?? result;
}

module.exports = {
  SUPABASE_DATA_API_LOCKDOWN_SQL,
  SENSITIVE_BUSINESS_TABLES,
  DATA_API_PRIVILEGES,
  LOCKDOWN_GRANTEES,
  EXPOSED_FUNCTION_INVENTORY_SQL,
  EXPOSED_VIEW_INVENTORY_SQL,
  SENSITIVE_GRANT_PROBE_SQL,
  applySupabaseDataApiLockdown,
  listSensitiveDataApiGrants,
};
