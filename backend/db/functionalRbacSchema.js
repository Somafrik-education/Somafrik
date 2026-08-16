"use strict";

const fs = require("node:fs");
const path = require("node:path");

const FUNCTIONAL_RBAC_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20260823_functional_rbac_canonical.sql"),
  "utf8",
);

async function assertFunctionalRbacSchemaPreflight(db) {
  const roles = await db.one("SELECT to_regclass('public.establishment_roles') AS ref");
  if (!roles?.ref) {
    const error = new Error("Schéma establishment_roles requis avant functional RBAC.");
    error.code = "FUNCTIONAL_RBAC_SCHEMA_PREFLIGHT";
    throw error;
  }
}

module.exports = {
  FUNCTIONAL_RBAC_SCHEMA_SQL,
  assertFunctionalRbacSchemaPreflight,
};
