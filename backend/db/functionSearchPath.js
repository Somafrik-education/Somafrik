"use strict";

const fs = require("fs");
const path = require("path");

const FUNCTION_SEARCH_PATH_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260905_p1_function_search_path.sql"),
  "utf8",
);

const MUTABLE_SEARCH_PATH_PROBE_SQL = `
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND p.proname NOT LIKE 'gist_%'
  AND p.proname NOT LIKE 'gbt_%'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_depend d
    JOIN pg_extension e ON e.oid = d.refobjid
    WHERE d.classid = 'pg_proc'::regclass
      AND d.objid = p.oid
      AND d.deptype = 'e'
  )
  AND (
    p.proconfig IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) AS cfg WHERE cfg LIKE 'search_path=%'
    )
  )
ORDER BY p.proname`;

async function applyFunctionSearchPath(executor) {
  if (!executor || typeof executor.query !== "function") {
    throw new Error("applyFunctionSearchPath: executor.query requis");
  }
  await executor.query(FUNCTION_SEARCH_PATH_SQL);
}

async function listMutableSearchPathFunctions(executor) {
  const result = await executor.query(MUTABLE_SEARCH_PATH_PROBE_SQL);
  return result.rows ?? result;
}

module.exports = {
  FUNCTION_SEARCH_PATH_SQL,
  MUTABLE_SEARCH_PATH_PROBE_SQL,
  applyFunctionSearchPath,
  listMutableSearchPathFunctions,
};
