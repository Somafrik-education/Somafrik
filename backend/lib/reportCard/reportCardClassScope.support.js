"use strict";

/**
 * BULLETIN-CLASSE-01 / L1 — support de test : rejoue des suites PostgreSQL existantes
 * sur le schéma MIGRÉ (portée classe × année). Activé uniquement par
 * SOMAFRIK_TEST_CLASS_SCOPE_MIGRATION=1 (fichiers *.classScope.pg.test.js), sur une
 * base jetable. Jamais utilisé au démarrage du serveur.
 */

const fs = require("node:fs");
const path = require("node:path");

const MIGRATION_SQL = fs.readFileSync(
  path.resolve(__dirname, "../../db/migrations/20261105_report_card_class_scope.sql"),
  "utf8"
);

async function applyClassScopeMigrationIfRequested(pool) {
  if (process.env.SOMAFRIK_TEST_CLASS_SCOPE_MIGRATION !== "1") return false;
  // Suites à schéma minimal : tables de référence nécessaires à la FK composite.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_years (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id)
    );
    CREATE TABLE IF NOT EXISTS classes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id UUID NOT NULL REFERENCES schools(id),
      academic_year_id UUID NOT NULL REFERENCES academic_years(id)
    );
  `);
  await pool.query(`BEGIN;\n${MIGRATION_SQL}\nCOMMIT;`);
  return true;
}

module.exports = { applyClassScopeMigrationIfRequested };
