"use strict";

const { Pool } = require("pg");
const {
  applyFunctionSearchPath,
  listMutableSearchPathFunctions,
} = require("../db/functionSearchPath");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();

async function main() {
  if (!DATABASE_URL) {
    console.log("functionSearchPath.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
    const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    try {
      await pool.query("SELECT 1");
    } catch {
      console.log("functionSearchPath.pg.test.js SKIP (PostgreSQL inaccessible)");
      return;
    }
    await pool.query(`
      CREATE OR REPLACE FUNCTION somafrik_search_path_probe()
      RETURNS integer
      LANGUAGE sql
      AS $$ SELECT 1 $$
    `);
    await pool.query(`
      CREATE OR REPLACE FUNCTION gist_search_path_probe()
      RETURNS integer
      LANGUAGE sql
      AS $$ SELECT 1 $$
    `);
    await applyFunctionSearchPath(pool);
    const mutable = await listMutableSearchPathFunctions(pool);
    const names = mutable.map((row) => row.function_name);
    if (names.includes("somafrik_search_path_probe")) {
      throw new Error(`search_path mutable après apply: ${names.join(", ")}`);
    }
    const gistCfg = await pool.query(
      `SELECT proconfig FROM pg_proc WHERE proname = 'gist_search_path_probe' LIMIT 1`,
    );
    const gistSearch = (gistCfg.rows[0]?.proconfig ?? []).some((cfg) => String(cfg).startsWith("search_path="));
    if (gistSearch) {
      throw new Error("gist_* ne doit pas recevoir SET search_path (étude btree_gist)");
    }
    const appCfg = await pool.query(
      `SELECT proconfig FROM pg_proc WHERE proname = 'somafrik_search_path_probe' LIMIT 1`,
    );
    const appSearch = (appCfg.rows[0]?.proconfig ?? []).some((cfg) =>
      String(cfg).includes("search_path="),
    );
    if (!appSearch) {
      throw new Error("somafrik_search_path_probe sans search_path après apply");
    }
    console.log("functionSearchPath.pg.test.js OK");
  } finally {
    await pool.query("DROP FUNCTION IF EXISTS somafrik_search_path_probe()");
    await pool.query("DROP FUNCTION IF EXISTS gist_search_path_probe()");
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
