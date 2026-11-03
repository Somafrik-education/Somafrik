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

test("migration : garanties créées avant retrait, aucun privilège accordé, aucune suppression de ligne", () => {
  const sql = executable(MIGRATION);
  const createSchool = sql.indexOf("uq_report_card_active_bindings_school\n");
  const dropPk = sql.indexOf("DROP CONSTRAINT report_card_active_bindings_pkey");
  assert.ok(createSchool > 0 && dropPk > createSchool, "index partiel établissement créé avant le retrait de la PK");
  assert.ok(sql.indexOf("CLASS_SCOPE_UNIQUE_INDEXES_INVALID") < dropPk, "contrôle de validité avant le retrait");
  assert.ok(sql.indexOf("uq_report_card_configuration_one_active_school") < sql.indexOf("DROP INDEX IF EXISTS uq_report_card_configuration_one_active;"));
  assert.doesNotMatch(sql, /\bGRANT\b|\bREVOKE\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(sql, /DROP\s+COLUMN/i);
});

test("rollback : refus si données de classe, garanties historiques rétablies avant retrait", () => {
  const sql = executable(ROLLBACK);
  assert.match(ROLLBACK, /CLASS_SCOPE_ROLLBACK_REFUSED/);
  const guard = sql.indexOf("RAISE EXCEPTION");
  assert.ok(guard > 0 && guard < sql.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS uq_report_card_configuration_one_active"), "refus vérifié en premier");
  assert.ok(sql.indexOf("PRIMARY KEY (school_id, model_key)") < sql.indexOf("DROP INDEX IF EXISTS uq_report_card_active_bindings_school"));
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
