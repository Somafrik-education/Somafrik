"use strict";

/**
 * Colonne d'alias login enseignant (ENS-####) après réconciliation du code public.
 * Source unique : migration 20260819_teacher_legacy_code.sql
 * (également présente dans schema.sql pour le boot complet).
 */
const fs = require("node:fs");
const path = require("node:path");

const TEACHERS_LEGACY_CODE_MIGRATION_PATH = path.join(
  __dirname,
  "migrations/20260819_teacher_legacy_code.sql",
);

const TEACHERS_LEGACY_CODE_SCHEMA_SQL = fs.readFileSync(TEACHERS_LEGACY_CODE_MIGRATION_PATH, "utf8");

/**
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<unknown> }} db
 */
async function ensureTeachersLegacyCodeSchema(db) {
  if (typeof db?.query !== "function") {
    throw new Error("ensureTeachersLegacyCodeSchema: db.query requis");
  }
  await db.query(TEACHERS_LEGACY_CODE_SCHEMA_SQL);
}

module.exports = {
  TEACHERS_LEGACY_CODE_MIGRATION_PATH,
  TEACHERS_LEGACY_CODE_SCHEMA_SQL,
  ensureTeachersLegacyCodeSchema,
};
