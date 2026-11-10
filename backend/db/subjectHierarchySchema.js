"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** BULLETIN-MODEL-01 — hiérarchie des matières (migration additive, idempotente). */
const SUBJECT_HIERARCHY_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261103_subject_hierarchy.sql"),
  "utf8",
);

/** Retour arrière documenté : jamais exécuté automatiquement. */
const SUBJECT_HIERARCHY_ROLLBACK_SQL = fs.readFileSync(
  path.join(__dirname, "migrations/20261103_subject_hierarchy.rollback.sql"),
  "utf8",
);

async function ensureSubjectHierarchySchema(db) {
  if (typeof db?.one !== "function" || typeof db?.query !== "function") {
    throw new Error("PostgreSQL requis pour la hiérarchie des matières.");
  }
  const found = await db.one("SELECT to_regclass('public.subjects') AS ref");
  if (!found?.ref) {
    const error = new Error("Schéma subjects requis avant la hiérarchie des matières.");
    error.code = "SUBJECT_HIERARCHY_SCHEMA_PREFLIGHT";
    throw error;
  }
  await db.query(SUBJECT_HIERARCHY_SCHEMA_SQL);
}

module.exports = {
  SUBJECT_HIERARCHY_SCHEMA_SQL,
  SUBJECT_HIERARCHY_ROLLBACK_SQL,
  ensureSubjectHierarchySchema,
};
