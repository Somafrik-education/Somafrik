"use strict";

/**
 * BULLETIN-CLASSE-01 / L1 — gardes statiques (sans base) de la migration de portée classe.
 * Parcours PostgreSQL réels : reportCardClassScopeL1.pg.test.js et *.classScope.pg.test.js.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(BACKEND, "db/migrations");
const read = (rel) => fs.readFileSync(path.join(BACKEND, rel), "utf8");
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, "20261105_report_card_class_scope.sql"), "utf8");
const ROLLBACK = fs.readFileSync(path.join(MIGRATIONS, "20261105_report_card_class_scope.rollback.sql"), "utf8");
const PREFLIGHT = fs.readFileSync(path.join(MIGRATIONS, "20261105_report_card_class_scope.preflight.sql"), "utf8");

function noComments(sql) {
  return sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

function executable(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, "''");
}

test("migration jamais exécutée au démarrage ni par le code applicatif", () => {
  for (const rel of ["db/postgresRepository.js", "server.js", "db/repositoryFactory.js", "db/reportCardConfigurationSql.js", "db/reportCardConfigurationPgStore.js"]) {
    const file = path.join(BACKEND, rel);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /20261105_report_card_class_scope(\.rollback)?\.sql["'`]/, `${rel} : chargement du fichier de migration`);
    assert.doesNotMatch(src, /uq_report_card_active_bindings_school|PRIMARY KEY \(id\)/, `${rel} : instructions de la migration`);
  }
  // Le seul module (hors tests) qui lit la migration est le support de test, activé explicitement.
  const support = read("lib/reportCard/reportCardClassScope.support.js");
  assert.match(support, /SOMAFRIK_TEST_CLASS_SCOPE_MIGRATION !== "1"/);
});

test("démarrage : l'index historique n'est recréé que tant que class_id n'existe pas", () => {
  const boot = read("db/reportCardConfigurationSql.js");
  assert.match(boot, /IF NOT EXISTS \([\s\S]{0,200}attname = 'class_id'[\s\S]{0,200}CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active/);
});

test("migration : garanties créées et validées avant retrait, provenance, aucun privilège, aucune suppression", () => {
  const sql = executable(MIGRATION);
  const text = noComments(MIGRATION);
  const createSchool = text.indexOf("CREATE UNIQUE INDEX uq_report_card_active_bindings_school");
  const finalCheck = text.indexOf("CLASS_SCOPE_UNIQUE_INDEXES_INVALID");
  const dropPk = text.indexOf("DROP CONSTRAINT report_card_active_bindings_pkey");
  const dropHistorical = text.indexOf("DROP INDEX uq_report_card_configuration_one_active");
  assert.ok(createSchool > 0 && finalCheck > createSchool && dropPk > finalCheck && dropHistorical > finalCheck,
    "index partiels créés puis validés avant tout retrait");
  // Validation structurelle (et non un simple comptage) de tout objet homonyme.
  for (const token of ["pg_get_constraintdef", "pg_get_expr(i.indpred, i.indrelid)", "indkey", "conrelid", "CLASS_SCOPE_DEFINITION_MISMATCH", "CLASS_SCOPE_FOREIGN_OBJECT"]) {
    assert.ok(MIGRATION.includes(token), token);
  }
  assert.doesNotMatch(sql, /IF NOT EXISTS uq_report_card|ADD COLUMN IF NOT EXISTS/, "pas d'adoption silencieuse d'un objet homonyme");
  assert.ok((MIGRATION.match(/COMMENT ON (COLUMN|CONSTRAINT|INDEX)/g) || []).length >= 12, "provenance posée sur chaque objet créé");
  assert.doesNotMatch(sql, /\bGRANT\b|\bREVOKE\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b|DROP\s+COLUMN/i);
});

test("rollback : refus si données de classe ou objet étranger, garanties historiques rétablies avant retrait", () => {
  const sql = executable(ROLLBACK);
  const text = noComments(ROLLBACK);
  const refuse = text.indexOf("CLASS_SCOPE_ROLLBACK_REFUSED");
  const inventory = text.indexOf("pg_temp.l1_owned_constraint(bindings");
  const restore = text.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active");
  const firstDrop = text.indexOf("FOREACH item IN ARRAY drop_constraints");
  assert.ok(refuse > 0 && inventory > refuse && restore > inventory && firstDrop > restore, "refus, inventaire de provenance, restauration, puis retraits");
  assert.ok(text.indexOf("PRIMARY KEY (school_id, model_key)") < firstDrop);
  assert.match(ROLLBACK, /CLASS_SCOPE_ROLLBACK_FOREIGN_OBJECT/);
  // Aucun retrait inconditionnel d'un objet nommé L1 : uniquement les listes validées par marqueur.
  assert.doesNotMatch(sql, /DROP CONSTRAINT IF EXISTS|DROP INDEX IF EXISTS|DROP COLUMN IF EXISTS/);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b|report_card_published_snapshots/i);
});

test("préflight : strictement en lecture seule, cible confirmée", () => {
  const sql = executable(PREFLIGHT);
  assert.match(sql, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /\bCOMMIT\b|\bEND\s*;/i);
  for (const keyword of ["INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE", "VACUUM", "REINDEX", "LOCK", "COPY", "CALL", "DO"]) {
    assert.doesNotMatch(sql, new RegExp(`(^|;|\\s)${keyword}\\s`, "i"), `mot-clé d'écriture interdit : ${keyword}`);
  }
  assert.match(sql, /expected_db/);
  assert.match(sql, /expected_env/);
});
