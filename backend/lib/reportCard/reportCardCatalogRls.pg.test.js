"use strict";

/**
 * BULLETIN-PREPROD-02 — catalogue sous RLS avec un rôle applicatif NON propriétaire.
 *
 * Reproduit la configuration Supabase : rôles anon / authenticated, privilèges par
 * défaut accordés sur le schéma public. La migration est appliquée par le
 * superutilisateur (propriétaire des tables) avec somafrik.catalog_app_role = rôle de
 * l'API ; l'API se connecte ensuite avec ce rôle distinct, sans superutilisateur ni
 * BYPASSRLS. Base jetable `somafrik_report_card_catalog_rls_it`.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { createPostgresRepository } = require("../../db/repositoryFactory");
const { REPORT_CARD_CATALOG_SQL } = require("../../db/reportCardCatalogSchema");
const { createReportCardCatalogPgStore } = require("../../db/reportCardCatalogPgStore");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = "somafrik_report_card_catalog_rls_it";
const APP_ROLE = "somafrik_catalog_it_app";
const APP_PASSWORD = "catalog-it-app";
const skip = DATABASE_URL ? false : "DATABASE_URL absent (exécuter via npm run test:backend-baseline:pg)";
const TABLES = ["report_card_catalog_models", "report_card_catalog_availability", "report_card_catalog_availability_audit"];
const PREFLIGHT = path.resolve(__dirname, "../../db/migrations/20261104_report_card_catalog.preflight.sql");

function withDatabase(url, name, credentials) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  if (credentials) {
    parsed.username = credentials.user;
    parsed.password = credentials.password;
  }
  return parsed.toString();
}

function migrationFor(appRole) {
  const setting = appRole ? `SELECT set_config('somafrik.catalog_app_role', '${appRole}', true);\n` : "";
  return `BEGIN;\n${setting}${REPORT_CARD_CATALOG_SQL}\nCOMMIT;`;
}

function psqlAvailable() {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function preflight(url) {
  const out = execFileSync(
    "psql",
    [url, "-X", "-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1", "-v", `expected_db=${IT_DATABASE}`, "-f", PREFLIGHT],
    { encoding: "utf8" }
  );
  const rows = out.split("\n").map((line) => line.split("|")).filter((cols) => /^P\d\d |^VERDICT$/.test(cols[0] || ""));
  return Object.fromEntries(rows.map(([check, status, detail]) => [check.slice(0, 3) === "VER" ? "VERDICT" : check.slice(0, 3), { status, detail }]));
}

const state = {};

before(async () => {
  if (skip) return;
  const admin = new Pool({ connectionString: withDatabase(DATABASE_URL, "postgres") });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [IT_DATABASE]);
    if (!existing.rowCount) await admin.query(`CREATE DATABASE ${IT_DATABASE}`);
    // Rôles de cluster : créés une seule fois, sans privilège particulier.
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
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
  state.repo = createPostgresRepository(url);
  await state.repo.init();
  state.owner = state.repo.pool;
  state.url = url;
  state.appUrl = withDatabase(DATABASE_URL, IT_DATABASE, { user: APP_ROLE, password: APP_PASSWORD });
  // Configuration type Supabase : privilèges par défaut ouverts aux rôles du Data API.
  await state.owner.query(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
    GRANT SELECT ON countries, schools, users, report_card_configuration_requests TO ${APP_ROLE};
  `);
  state.cd = (await state.owner.query("INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('RDC', 'CD', '+243', 'CDF') RETURNING id::text AS id")).rows[0].id;
  state.bi = (await state.owner.query("INSERT INTO countries (name, iso_code, phone_code, currency) VALUES ('Burundi', 'BI', '+257', 'BIF') RETURNING id::text AS id")).rows[0].id;
  state.preflightBefore = psqlAvailable() ? preflight(state.appUrl) : null;
  await state.owner.query(migrationFor(APP_ROLE));
  state.app = new Pool({ connectionString: state.appUrl });
});

after(async () => {
  if (state.app) await state.app.end().catch(() => {});
  if (state.owner && !state.owner.ended) await state.owner.end().catch(() => {});
});

test("rôle applicatif : ni superutilisateur, ni BYPASSRLS, ni propriétaire des tables", { skip }, async () => {
  const role = (await state.app.query("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0];
  assert.deepEqual(role, { current_user: APP_ROLE, rolsuper: false, rolbypassrls: false });
  const owners = (await state.owner.query(
    "SELECT relname, pg_get_userbyid(relowner) AS owner, relrowsecurity FROM pg_class WHERE relname = ANY($1) ORDER BY relname",
    [TABLES]
  )).rows;
  assert.equal(owners.length, 3);
  for (const row of owners) {
    assert.notEqual(row.owner, APP_ROLE);
    assert.equal(row.relrowsecurity, true, `${row.relname} : RLS active`);
  }
});

test("store du catalogue via le rôle non propriétaire : lecture, disponibilité, audit", { skip }, async () => {
  const store = createReportCardCatalogPgStore(state.app);
  assert.deepEqual((await store.listModels()).map((m) => m.model_id), ["berceau", "colombiere"], "catalogue visible (pas de liste vide RLS)");
  assert.equal(await store.isAvailable("colombiere", state.cd), false);
  const enabled = await store.setAvailability({ modelId: "colombiere", countryId: state.cd, available: true, actorId: "sa-1" });
  assert.equal(enabled.changed, true);
  const disabled = await store.setAvailability({ modelId: "colombiere", countryId: state.cd, available: false, actorId: "sa-1" });
  assert.equal(disabled.previous, true, "mise à jour (upsert + FOR UPDATE) autorisée");
  assert.equal(await store.isAvailable("colombiere", state.cd), false);
  await store.setAvailability({ modelId: "berceau", countryId: state.bi, available: true, actorId: "sa-1" });
  assert.equal(await store.isAvailable("berceau", state.bi), true);
  const audit = await store.listAudit({ modelId: "colombiere" });
  assert.deepEqual(audit.map((row) => [row.old_available, row.new_available]), [[true, false], [null, true]]);
  assert.equal((await store.listAvailability()).length, 2);
});

test("rôle applicatif : moindre privilège (journal en ajout seul, modèles en lecture seule)", { skip }, async () => {
  for (const sql of [
    "DELETE FROM report_card_catalog_availability_audit",
    "UPDATE report_card_catalog_availability_audit SET new_available = true",
    "INSERT INTO report_card_catalog_models (model_id, version, name, description, presentation_style) VALUES ('x', 1, 'x', 'x', 'simple')",
    "UPDATE report_card_catalog_models SET status = 'retired'",
    "DELETE FROM report_card_catalog_availability",
  ]) {
    await assert.rejects(state.app.query(sql), (err) => err.code === "42501", sql);
  }
});

test("anon / authenticated : aucun accès direct malgré les privilèges par défaut Supabase", { skip }, async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const table of TABLES) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const row = (await state.owner.query("SELECT has_table_privilege($1, $2, $3) AS ok", [role, `public.${table}`, privilege])).rows[0];
        assert.equal(row.ok, false, `${role} ${privilege} ${table}`);
      }
    }
    const seq = (await state.owner.query("SELECT has_sequence_privilege($1, 'public.report_card_catalog_availability_audit_id_seq', 'USAGE') AS ok", [role])).rows[0];
    assert.equal(seq.ok, false, `${role} séquence`);
    const client = await state.owner.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(client.query("SELECT * FROM report_card_catalog_models"), (err) => err.code === "42501");
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  }
});

test("garde-fou : sans politique, le rôle non propriétaire est bloqué (cas #1053 initial)", { skip }, async () => {
  const client = await state.owner.connect();
  try {
    await client.query("BEGIN");
    await client.query("DROP POLICY report_card_catalog_models_app_select ON report_card_catalog_models");
    await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    const rows = (await client.query("SELECT count(*)::int AS n FROM report_card_catalog_models")).rows[0];
    assert.equal(rows.n, 0, "RLS sans politique : catalogue vide pour le rôle applicatif");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("migration : ré-exécutable ; rôle public ou inconnu refusé", { skip }, async () => {
  await state.owner.query(migrationFor(APP_ROLE));
  const policies = (await state.owner.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename = ANY($1)", [TABLES])).rows[0];
  assert.equal(policies.n, 6, "politiques recréées à l'identique, sans doublon");
  for (const role of ["anon", "authenticated", "PUBLIC", "inconnu_xyz"]) {
    await assert.rejects(state.owner.query(migrationFor(role)), /somafrik\.catalog_app_role/);
    await state.owner.query("ROLLBACK").catch(() => {});
  }
  assert.equal((await createReportCardCatalogPgStore(state.app).listModels()).length, 2, "accès conservé après un refus");
});

test("préflight via la connexion du rôle applicatif : P16–P19 GO après migration, NO-GO si politique absente", { skip: skip || (psqlAvailable() ? false : "psql absent") }, async () => {
  assert.equal(state.preflightBefore.P09.status, "GO", "avant : tables absentes");
  assert.equal(state.preflightBefore.P05.status, "WARN", "avant : rôle API sans CREATE → migration par un administrateur");
  const afterMigration = preflight(state.appUrl);
  for (const check of ["P15", "P16", "P17", "P18", "P19"]) assert.equal(afterMigration[check].status, "GO", `${check} : ${afterMigration[check].detail}`);
  assert.match(afterMigration.VERDICT.status, /^GO/);
  await state.owner.query("DROP POLICY report_card_catalog_availability_app_update ON report_card_catalog_availability");
  try {
    const broken = preflight(state.appUrl);
    assert.equal(broken.P18.status, "NO-GO");
    assert.match(broken.P18.detail, /report_card_catalog_availability:UPDATE/);
    assert.equal(broken.VERDICT.status, "NO-GO");
  } finally {
    await state.owner.query(migrationFor(APP_ROLE));
  }
  await state.owner.query("GRANT SELECT ON report_card_catalog_models TO anon");
  try {
    assert.equal(preflight(state.appUrl).P19.status, "NO-GO");
  } finally {
    await state.owner.query("REVOKE ALL ON report_card_catalog_models FROM anon");
  }
});
