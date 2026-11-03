"use strict";

/**
 * BULLETIN-CLASSE-01 / L1 — migration de portée classe × année (PostgreSQL réel, base jetable).
 *
 * Base `somafrik_report_card_class_scope_l1_it`, initialisée par le démarrage réel
 * (repository.init). La migration et le rollback sont appliqués EXPLICITEMENT par ce test,
 * jamais au démarrage. « Ancien code » = SQL historique du store (avant L1), recopié ici ;
 * « nouveau code » = createReportCardConfigurationPgStore (L1).
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../../db/repositoryFactory");
const { REPORT_CARD_CONFIGURATION_SQL } = require("../../db/reportCardConfigurationSql");
const { REPORT_CARD_CATALOG_SQL } = require("../../db/reportCardCatalogSchema");
const { createReportCardConfigurationPgStore } = require("../../db/reportCardConfigurationPgStore");
const { reportCardIdFor } = require("./reportCardClassPublication");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_report_card_class_scope_l1_it";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";
const MIGRATIONS = path.resolve(__dirname, "../../db/migrations");
const MIGRATION_SQL = fs.readFileSync(path.join(MIGRATIONS, "20261105_report_card_class_scope.sql"), "utf8");
const ROLLBACK_SQL = fs.readFileSync(path.join(MIGRATIONS, "20261105_report_card_class_scope.rollback.sql"), "utf8");
const MODEL = "catalog-colombiere";

// SQL du store AVANT L1 (ancien code), pour démontrer l'ordre de mise en service.
const OLD_UPSERT_SQL = `INSERT INTO report_card_active_bindings (
    school_id, model_key, request_id, engine_id, profile_id, profile_version, profile_spec_sha256,
    schema_id, schema_version, schema_spec_sha256, rendering_template_id, rendering_template_version,
    rendering_template_spec_sha256, activated_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  ON CONFLICT (school_id, model_key) DO UPDATE SET
    request_id = EXCLUDED.request_id, profile_version = EXCLUDED.profile_version, activated_at = EXCLUDED.activated_at
  RETURNING *`;
const OLD_GET_SQL = "SELECT * FROM report_card_active_bindings WHERE school_id = $1 AND model_key = $2";

function withDatabase(url, name) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const state = {};

async function one(sql, params) {
  return (await state.pool.query(sql, params)).rows[0];
}

/** Applique un script dans une transaction (équivalent de psql --single-transaction). */
async function runScript(sql) {
  const client = await state.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function seedSchool(code, short) {
  await state.pool.query("ALTER TABLE schools DISABLE TRIGGER USER");
  const schoolId = (await one(
    "INSERT INTO schools (country_id, school_code, login_code, short_code, name, status) VALUES ($1,$2,$3,$4,$5,'active') RETURNING id",
    [state.countryId, code, `CD-${short}-26-001`, short, `École ${short}`]
  )).id;
  await state.pool.query("ALTER TABLE schools ENABLE TRIGGER USER");
  const year1 = (await one("INSERT INTO academic_years (school_id, name, is_current) VALUES ($1,'2026-2027',TRUE) RETURNING id", [schoolId])).id;
  const year2 = (await one("INSERT INTO academic_years (school_id, name) VALUES ($1,'2027-2028') RETURNING id", [schoolId])).id;
  const classes = {};
  for (const [key, yearId] of [["C1", year1], ["C2", year1], ["C3", year2]]) {
    classes[key] = (await one("INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,$3,$4) RETURNING id", [schoolId, yearId, `${short}-${key}`, key])).id;
  }
  return { schoolId, year1, year2, classes };
}

async function newRequest(schoolId, { status = "ACTIVE", classId = null, yearId = null, modelKey = MODEL } = {}) {
  const cols = ["school_id", "model_key", "status"];
  const values = [schoolId, modelKey, status];
  if (classId || yearId) {
    cols.push("class_id", "academic_year_id");
    values.push(classId, yearId);
  }
  return (await one(
    `INSERT INTO report_card_configuration_requests (${cols.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    values
  )).id;
}

function bindingRow(schoolId, requestId, version) {
  return {
    school_id: schoolId,
    model_key: MODEL,
    request_id: requestId,
    engine_id: "somafrik.report_card.v1",
    profile_id: state.profileId,
    profile_version: version,
    profile_spec_sha256: `p${version}`,
    schema_id: state.schemaId,
    schema_version: 1,
    schema_spec_sha256: "s1",
    rendering_template_id: state.templateId,
    rendering_template_version: 1,
    rendering_template_spec_sha256: "t1",
    activated_at: new Date().toISOString(),
  };
}

function oldParams(row) {
  return [
    row.school_id, row.model_key, row.request_id, row.engine_id, row.profile_id, row.profile_version, row.profile_spec_sha256,
    row.schema_id, row.schema_version, row.schema_spec_sha256, row.rendering_template_id, row.rendering_template_version,
    row.rendering_template_spec_sha256, row.activated_at,
  ];
}

async function insertClassBinding(school, classKey, yearId, requestId) {
  return state.pool.query(
    `INSERT INTO report_card_active_bindings (school_id, model_key, request_id, engine_id, profile_id, profile_version,
       profile_spec_sha256, schema_id, schema_version, schema_spec_sha256, rendering_template_id, rendering_template_version,
       rendering_template_spec_sha256, academic_year_id, class_id)
     VALUES ($1,$2,$3,'somafrik.report_card.v1',$4,9,'class',$5,1,'s1',$6,1,'t1',$7,$8)`,
    [school.schoolId, MODEL, requestId, state.profileId, state.schemaId, state.templateId, yearId, classKey ? school.classes[classKey] : null]
  );
}

async function primaryKeyColumns() {
  return (await state.pool.query(
    `SELECT a.attname FROM pg_constraint con
       CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      WHERE con.conrelid = 'report_card_active_bindings'::regclass AND con.contype = 'p' ORDER BY k.ord`
  )).rows.map((row) => row.attname);
}

async function indexExists(name) {
  return (await one("SELECT count(*)::int AS n FROM pg_class WHERE relname = $1", [name])).n === 1;
}

async function schoolBindingsSnapshot() {
  return (await state.pool.query(
    `SELECT school_id, model_key, request_id, profile_version, profile_spec_sha256, activated_at
       FROM report_card_active_bindings ORDER BY school_id, model_key`
  )).rows;
}

async function publishedSnapshotBytes() {
  return (await state.pool.query(
    "SELECT report_card_id, encode(canonical_bytes, 'hex') AS bytes, snapshot_sha256, snapshot_signature FROM report_card_published_snapshots ORDER BY report_card_id"
  )).rows;
}

async function expectSqlError(promise, pattern) {
  await assert.rejects(promise, (err) => {
    assert.match(`${err.code} ${err.message} ${err.constraint || ""}`, pattern);
    return true;
  });
}

before(async () => {
  if (skip) return;
  const admin = new Pool({ connectionString: withDatabase(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(DATABASE_URL, IT_DATABASE);
  const reset = new Pool({ connectionString: url });
  try {
    await reset.query("DROP SCHEMA public CASCADE");
    await reset.query("CREATE SCHEMA public");
  } finally {
    await reset.end();
  }
  process.env.SOMAFRIK_SKIP_DEMO_SEED = "true";
  state.url = url;
  state.repo = createPostgresRepository(url);
  await state.repo.init();
  state.pool = state.repo.pool;
  state.store = createReportCardConfigurationPgStore(state.pool);
  state.countryId = (await one("INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC','CD','+243','CDF') RETURNING id")).id;
  state.a = await seedSchool("CD-2026-0911", "LA");
  state.b = await seedSchool("CD-2026-0912", "LB");
  state.templateId = (await one("INSERT INTO report_card_rendering_templates (school_id, template_key) VALUES ($1,'tpl') RETURNING id", [state.a.schoolId])).id;
  state.templateIdB = (await one("INSERT INTO report_card_rendering_templates (school_id, template_key) VALUES ($1,'tpl') RETURNING id", [state.b.schoolId])).id;
  state.profileId = "11111111-1111-4111-8111-111111111111";
  state.schemaId = "22222222-2222-4222-8222-222222222222";
  // Catalogue #1053 installé (RLS) : ses protections doivent rester identiques.
  await runScript(REPORT_CARD_CATALOG_SQL);
  // Snapshot publié témoin (octets signés) : jamais modifié par la migration ni le rollback.
  await state.pool.query(
    `INSERT INTO report_card_published_snapshots (school_id, report_card_id, published_snapshot_version, published_at, status,
       verification_status, public_id, token_hash, token_ciphertext, wrapping_key_id, canonical_bytes, snapshot_sha256,
       snapshot_signature, signing_key_id, engine_id)
     VALUES ($1,'rc-temoin',1,NOW(),'PUBLISHED','ACTIVE','pub-temoin','h','c','w',decode('7b2276223a317d','hex'),'sha','sig','k','somafrik.report_card.v1')`,
    [state.a.schoolId]
  );
});

after(async () => {
  if (state.pool && !state.pool.ended) await state.pool.end().catch(() => {});
});

test("1. ancien schéma + ancien code : liaison établissement créée, mise à jour, relue", { skip }, async () => {
  const requestId = await newRequest(state.a.schoolId);
  const row = bindingRow(state.a.schoolId, requestId, 1);
  await state.pool.query(OLD_UPSERT_SQL, oldParams(row));
  await state.pool.query(OLD_UPSERT_SQL, oldParams({ ...row, profile_version: 2 }));
  const read = (await state.pool.query(OLD_GET_SQL, [state.a.schoolId, MODEL])).rows;
  assert.equal(read.length, 1);
  assert.equal(read[0].profile_version, 2);
  assert.deepEqual(await primaryKeyColumns(), ["school_id", "model_key"]);
  state.requestA = requestId;
});

test("2. ancien schéma + nouveau code L1 : création, UPSERT, lecture, demande active", { skip }, async () => {
  const saved = await state.store.withTx((tx) => tx.upsertBinding(bindingRow(state.a.schoolId, state.requestA, 3)));
  assert.equal(saved.profile_version, 3);
  assert.equal((await state.store.getBinding(state.a.schoolId, MODEL)).profile_version, 3);
  const requestB = await newRequest(state.b.schoolId);
  await state.store.upsertBinding({ ...bindingRow(state.b.schoolId, requestB, 1), rendering_template_id: state.templateIdB });
  assert.equal((await state.store.getBinding(state.b.schoolId, MODEL)).request_id, requestB);
  const active = await state.store.withTx((tx) => tx.getActiveByPair(state.a.schoolId, MODEL));
  assert.equal(active.id, state.requestA);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, "class_id"), false, "forme de la liaison exposée inchangée");
  state.reportCardIdBefore = reportCardIdFor({ schoolId: state.a.schoolId, classId: state.a.classes.C1, academicYearId: state.a.year1, modelKey: saved.model_key, scopeId: "T1", studentUuid: "s-1" });
  state.bindingsBefore = await schoolBindingsSnapshot();
  state.snapshotsBefore = await publishedSnapshotBytes();
  state.catalogSecurityBefore = (await state.pool.query(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'report_card_catalog%' AND relkind = 'r' ORDER BY relname"
  )).rows;
  state.anonBefore = (await one("SELECT has_table_privilege('anon', 'report_card_active_bindings', 'SELECT') AS a, has_table_privilege('authenticated', 'report_card_configuration_requests', 'SELECT') AS b"));
});

test("3. migration appliquée deux fois : clé technique, aucune perte, index, FK conservées", { skip }, async () => {
  await runScript(MIGRATION_SQL);
  await runScript(MIGRATION_SQL);
  assert.deepEqual(await primaryKeyColumns(), ["id"]);
  const ids = (await state.pool.query("SELECT id, class_id, academic_year_id FROM report_card_active_bindings")).rows;
  assert.equal(ids.length, 2);
  for (const row of ids) {
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    assert.equal(row.class_id, null);
    assert.equal(row.academic_year_id, null);
  }
  assert.deepEqual(await schoolBindingsSnapshot(), state.bindingsBefore, "aucune perte ni modification des liaisons");
  for (const name of ["uq_report_card_active_bindings_school", "uq_report_card_active_bindings_class",
    "uq_report_card_configuration_one_active_school", "uq_report_card_configuration_one_active_class"]) {
    assert.equal(await indexExists(name), true, name);
  }
  assert.equal(await indexExists("uq_report_card_configuration_one_active"), false);
  const fks = (await state.pool.query(
    "SELECT conname FROM pg_constraint WHERE conname IN ('report_card_active_bindings_request_tenant','report_card_configuration_requests_template_tenant')"
  )).rows;
  assert.equal(fks.length, 2, "clés étrangères existantes conservées");
});

test("4. nouveau schéma + nouveau code L1 : liaison établissement non confondue avec une liaison de classe", { skip }, async () => {
  const classRequest = await newRequest(state.a.schoolId, { classId: state.a.classes.C1, yearId: state.a.year1 });
  await insertClassBinding(state.a, "C1", state.a.year1, classRequest);
  const school = await state.store.getBinding(state.a.schoolId, MODEL);
  assert.equal(school.request_id, state.requestA, "getBinding : liaison établissement, jamais celle de C1");
  assert.equal(school.profile_version, 3);
  const active = await state.store.withTx((tx) => tx.getActiveByPair(state.a.schoolId, MODEL));
  assert.equal(active.id, state.requestA, "getActiveByPair : demande établissement, jamais celle de C1");
  const updated = await state.store.withTx((tx) => tx.upsertBinding(bindingRow(state.a.schoolId, state.requestA, 4)));
  assert.equal(updated.profile_version, 4);
  const classRow = await one("SELECT profile_version FROM report_card_active_bindings WHERE class_id = $1", [state.a.classes.C1]);
  assert.equal(classRow.profile_version, 9, "UPSERT établissement sans effet sur la liaison de classe");
  const schoolRows = await one("SELECT count(*)::int AS n FROM report_card_active_bindings WHERE school_id = $1 AND class_id IS NULL", [state.a.schoolId]);
  assert.equal(schoolRows.n, 1, "toujours une seule liaison établissement");
  assert.equal(updated.model_key, MODEL);
  const reportCardId = reportCardIdFor({ schoolId: state.a.schoolId, classId: state.a.classes.C1, academicYearId: state.a.year1, modelKey: updated.model_key, scopeId: "T1", studentUuid: "s-1" });
  assert.equal(reportCardId, state.reportCardIdBefore, "report_card_id inchangé");
  assert.equal((await state.store.getBinding(state.b.schoolId, MODEL)).profile_version, 1, "établissement B inchangé");
});

test("5. nouveau schéma + ancien code : incompatible (ordre de déploiement interdit)", { skip }, async () => {
  await expectSqlError(state.pool.query(OLD_UPSERT_SQL, oldParams(bindingRow(state.a.schoolId, state.requestA, 5))), /42P10/);
  const oldRead = (await state.pool.query(OLD_GET_SQL, [state.a.schoolId, MODEL])).rows;
  assert.equal(oldRead.length, 2, "l'ancienne lecture mélangerait établissement et classe");
});

test("6. intégrité : établissement, année, paire classe/année, doublons", { skip }, async () => {
  const request = await newRequest(state.a.schoolId, { status: "SUBMITTED" });
  // Classe d'un autre établissement.
  await expectSqlError(
    state.pool.query(
      `INSERT INTO report_card_active_bindings (school_id, model_key, request_id, engine_id, profile_id, profile_version, profile_spec_sha256,
         schema_id, schema_version, schema_spec_sha256, rendering_template_id, rendering_template_version, rendering_template_spec_sha256,
         academic_year_id, class_id) VALUES ($1,$2,$3,'e',$4,1,'p',$5,1,'s',$6,1,'t',$7,$8)`,
      [state.a.schoolId, MODEL, request, state.profileId, state.schemaId, state.templateId, state.b.year1, state.b.classes.C1]
    ),
    /report_card_active_bindings_class_tenant/
  );
  // Année incompatible avec la classe (C3 appartient à l'année 2).
  await expectSqlError(insertClassBinding(state.a, "C3", state.a.year1, request), /report_card_active_bindings_class_tenant/);
  // Classe sans année / année sans classe.
  await expectSqlError(insertClassBinding(state.a, "C2", null, request), /report_card_active_bindings_scope_pair/);
  await expectSqlError(insertClassBinding(state.a, null, state.a.year1, request), /report_card_active_bindings_scope_pair/);
  // Doublon de liaison de classe (C1 existe déjà) et doublon établissement.
  await expectSqlError(insertClassBinding(state.a, "C1", state.a.year1, request), /uq_report_card_active_bindings_class/);
  await expectSqlError(
    state.pool.query(
      `INSERT INTO report_card_active_bindings (school_id, model_key, request_id, engine_id, profile_id, profile_version, profile_spec_sha256,
         schema_id, schema_version, schema_spec_sha256, rendering_template_id, rendering_template_version, rendering_template_spec_sha256)
       VALUES ($1,$2,$3,'e',$4,1,'p',$5,1,'s',$6,1,'t')`,
      [state.a.schoolId, MODEL, request, state.profileId, state.schemaId, state.templateId]
    ),
    /uq_report_card_active_bindings_school/
  );
  // Demandes : classe d'un autre établissement, paire incomplète, doublon ACTIVE de classe et d'établissement.
  await expectSqlError(newRequest(state.a.schoolId, { classId: state.b.classes.C1, yearId: state.b.year1 }), /requests_class_tenant/);
  await expectSqlError(newRequest(state.a.schoolId, { classId: state.a.classes.C2, yearId: null }), /requests_scope_pair/);
  await expectSqlError(newRequest(state.a.schoolId, { classId: state.a.classes.C1, yearId: state.a.year1 }), /one_active_class/);
  await expectSqlError(newRequest(state.a.schoolId), /one_active_school/);
  // Une demande ACTIVE par classe : C2 indépendante de C1.
  await newRequest(state.a.schoolId, { classId: state.a.classes.C2, yearId: state.a.year1 });
});

test("7. redémarrage après migration : le démarrage ne recrée pas l'index historique", { skip }, async () => {
  await runScript(REPORT_CARD_CONFIGURATION_SQL);
  assert.equal(await indexExists("uq_report_card_configuration_one_active"), false);
  assert.deepEqual(await primaryKeyColumns(), ["id"]);
  const actives = await one("SELECT count(*)::int AS n FROM report_card_configuration_requests WHERE school_id = $1 AND model_key = $2 AND status = 'ACTIVE'", [state.a.schoolId, MODEL]);
  assert.equal(actives.n, 3, "établissement + C1 + C2 : coexistent après redémarrage");
});

test("8. sécurité : catalogue #1053 et rôles anon / authenticated inchangés", { skip }, async () => {
  const catalog = (await state.pool.query(
    "SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'report_card_catalog%' AND relkind = 'r' ORDER BY relname"
  )).rows;
  assert.deepEqual(catalog, state.catalogSecurityBefore);
  assert.ok(catalog.every((row) => row.relrowsecurity === true));
  const anon = await one("SELECT has_table_privilege('anon', 'report_card_active_bindings', 'SELECT') AS a, has_table_privilege('authenticated', 'report_card_configuration_requests', 'SELECT') AS b");
  assert.deepEqual(anon, state.anonBefore, "aucun privilège ajouté par L1");
  assert.deepEqual(await publishedSnapshotBytes(), state.snapshotsBefore, "snapshot publié inchangé après migration");
});

test("9. rollback refusé tant qu'une configuration de classe existe ; rien n'est modifié", { skip }, async () => {
  await expectSqlError(runScript(ROLLBACK_SQL), /CLASS_SCOPE_ROLLBACK_REFUSED/);
  assert.deepEqual(await primaryKeyColumns(), ["id"]);
  assert.equal((await one("SELECT count(*)::int AS n FROM report_card_active_bindings WHERE class_id IS NOT NULL")).n, 1, "liaison de classe intacte");
  assert.equal((await one("SELECT count(*)::int AS n FROM report_card_configuration_requests WHERE class_id IS NOT NULL")).n, 2, "demandes de classe intactes");
});

test("10. rollback autorisé sans donnée de classe : garanties historiques rétablies, aucune perte", { skip }, async () => {
  // Données de classe créées par CE test uniquement : retirées par le test, jamais par le rollback.
  await state.pool.query("DELETE FROM report_card_active_bindings WHERE class_id IS NOT NULL");
  await state.pool.query("DELETE FROM report_card_configuration_requests WHERE class_id IS NOT NULL");
  const bindingsBeforeRollback = await schoolBindingsSnapshot();
  await runScript(ROLLBACK_SQL);
  await runScript(ROLLBACK_SQL);
  assert.deepEqual(await primaryKeyColumns(), ["school_id", "model_key"]);
  assert.equal(await indexExists("uq_report_card_configuration_one_active"), true);
  assert.equal(await indexExists("uq_report_card_active_bindings_school"), false);
  assert.deepEqual(await schoolBindingsSnapshot(), bindingsBeforeRollback, "liaisons établissement conservées");
  assert.deepEqual(await publishedSnapshotBytes(), state.snapshotsBefore, "snapshot publié inchangé après rollback");
  // Nouveau code L1 sur schéma rétabli : toujours fonctionnel.
  const saved = await state.store.withTx((tx) => tx.upsertBinding(bindingRow(state.a.schoolId, state.requestA, 6)));
  assert.equal(saved.profile_version, 6);
  assert.equal((await state.store.getBinding(state.a.schoolId, MODEL)).profile_version, 6);
  // Ré-application : sans erreur.
  await runScript(MIGRATION_SQL);
  assert.deepEqual(await primaryKeyColumns(), ["id"]);
  assert.equal((await state.store.getBinding(state.a.schoolId, MODEL)).profile_version, 6);
});

test("11. migration appliquée pendant l'exécution : le nouveau code s'adapte sans redémarrage", { skip }, async () => {
  await runScript(ROLLBACK_SQL);
  const store = createReportCardConfigurationPgStore(state.pool);
  await store.withTx((tx) => tx.upsertBinding(bindingRow(state.a.schoolId, state.requestA, 7)));
  await runScript(MIGRATION_SQL);
  const saved = await store.withTx((tx) => tx.upsertBinding(bindingRow(state.a.schoolId, state.requestA, 8)));
  assert.equal(saved.profile_version, 8);
  assert.equal((await one("SELECT count(*)::int AS n FROM report_card_active_bindings WHERE school_id = $1", [state.a.schoolId])).n, 1);
});

test("12. migration refusée si les prérequis manquent (aucun effet partiel)", { skip }, async () => {
  const empty = new Pool({ connectionString: withDatabase(DATABASE_URL, "postgres") });
  try {
    const name = `${IT_DATABASE}_empty`;
    const existing = await empty.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!existing.rowCount) await empty.query(`CREATE DATABASE ${name}`);
  } finally {
    await empty.end();
  }
  const pool = new Pool({ connectionString: withDatabase(DATABASE_URL, `${IT_DATABASE}_empty`) });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await assert.rejects(pool.query(`BEGIN; ${MIGRATION_SQL}; COMMIT;`), /CLASS_SCOPE_PREREQUISITES_MISSING/);
    await pool.query("ROLLBACK").catch(() => {});
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace")).rows[0].n, 0);
  } finally {
    await pool.end();
  }
});
