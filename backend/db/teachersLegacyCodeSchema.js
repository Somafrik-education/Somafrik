"use strict";

/**
 * ID-CANONICAL-01B — suppression de l'alias login enseignant.
 * 20260819 (ADD) reste immuable. Le boot applique 20260903 (DROP).
 */
const fs = require("node:fs");
const path = require("node:path");

const TEACHERS_LEGACY_CODE_MIGRATION_PATH = path.join(
  __dirname,
  "migrations/20260819_teacher_legacy_code.sql",
);
const TEACHERS_LEGACY_CODE_DROP_PATH = path.join(
  __dirname,
  "migrations/20260903_drop_legacy_teacher_code.sql",
);

const TEACHERS_LEGACY_CODE_SCHEMA_SQL = fs.readFileSync(TEACHERS_LEGACY_CODE_DROP_PATH, "utf8");

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
  TEACHERS_LEGACY_CODE_DROP_PATH,
  TEACHERS_LEGACY_CODE_SCHEMA_SQL,
  ensureTeachersLegacyCodeSchema,
};
