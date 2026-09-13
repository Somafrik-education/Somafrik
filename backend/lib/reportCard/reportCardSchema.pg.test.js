"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);
if (process.env.CI && !shouldRun) {
  throw new Error("DATABASE_URL + pg requis en CI pour report-card-schema PG");
}

const IT_DB = String(process.env.SOMAFRIK_REPORT_CARD_SCHEMA_IT_DATABASE ?? "somafrik_report_card_schema_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function loadLot2Pg() {
  try {
    return {
      sql: require("../../db/reportCardSchemaSql").REPORT_CARD_SCHEMA_SQL,
      createStore: require("../../db/reportCardSchemaPgStore").createReportCardSchemaPgStore,
    };
  } catch {
    return null;
  }
}

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureIsolatedDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function spec() {
  return {
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        columns: [{ id: "COL_TJ", order: 1, kind: "score_component", score_component_id: "TJ" }],
      },
    ],
  };
}

async function boot(pool) {
  const lot2 = loadLot2Pg();
  assert.ok(lot2, "LOT 2 PG store/DDL missing (RED)");
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(`
    CREATE TABLE schools (
      id UUID PRIMARY KEY,
      school_code TEXT UNIQUE
    )
  `);
  const schoolA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const schoolB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  await pool.query("INSERT INTO schools (id, school_code) VALUES ($1, 'A'), ($2, 'B')", [schoolA, schoolB]);
  await pool.query(lot2.sql);
  return { store: lot2.createStore(pool), schoolA, schoolB };
}

describe("report-card-schema PG constraints/versioning/isolation", { skip: !shouldRun }, () => {
  test("pg: tenant isolation, versioning, immutable spec", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const { store, schoolA, schoolB } = await boot(pool);
      const created = await store.createSchema({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaKey: "core",
        spec: spec(),
        activate: true,
      });
      const v2 = await store.addVersion({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaId: created.schema.id,
        spec: spec(),
      });
      await store.activateVersion({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaId: created.schema.id,
        version: v2.version,
      });
      const active = await store.getActive({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaId: created.schema.id,
      });
      assert.equal(active.version, 2);

      await assert.rejects(
        () =>
          store.updateDraftSpec({
            schoolId: schoolA,
            actorSchoolId: schoolA,
            schemaId: created.schema.id,
            version: 1,
            spec: spec(),
          }),
        (err) => err.code === "VERSION_IMMUTABLE"
      );
      assert.equal((await store.listSchemas(schoolB, schoolB)).length, 0);
      await assert.rejects(
        () =>
          store.getActive({
            schoolId: schoolB,
            actorSchoolId: schoolB,
            schemaId: created.schema.id,
          }),
        (err) => err.code === "SCHEMA_NOT_FOUND"
      );
      await assert.rejects(
        () => store.getActive({ schoolId: schoolA, schemaId: created.schema.id }),
        (err) => err.code === "TENANT_REQUIRED"
      );
    } finally {
      await pool.end();
    }
  });

  test("pg: concurrent version creation", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const { store, schoolA } = await boot(pool);
      const created = await store.createSchema({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaKey: "core",
        spec: spec(),
        activate: true,
      });
      const concurrent = await Promise.all([
        store.addVersion({
          schoolId: schoolA,
          actorSchoolId: schoolA,
          schemaId: created.schema.id,
          spec: spec(),
        }),
        store.addVersion({
          schoolId: schoolA,
          actorSchoolId: schoolA,
          schemaId: created.schema.id,
          spec: spec(),
        }),
      ]);
      assert.deepEqual(new Set(concurrent.map((row) => row.version)), new Set([2, 3]));
    } finally {
      await pool.end();
    }
  });

  test("pg: ACTIVE/SUPERSEDED/ARCHIVED cannot return to DRAFT", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const { store, schoolA } = await boot(pool);
      const created = await store.createSchema({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaKey: "core",
        spec: spec(),
        activate: true,
      });
      const v2 = await store.addVersion({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaId: created.schema.id,
        spec: spec(),
      });
      await store.activateVersion({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaId: created.schema.id,
        version: v2.version,
      });
      await assert.rejects(
        pool.query(
          `UPDATE report_card_schema_versions SET status = 'DRAFT' WHERE schema_id = $1 AND version = 1`,
          [created.schema.id]
        ),
        (err) => String(err.message).includes("REPORT_CARD_SCHEMA_VERSION_IMMUTABLE")
      );
      await assert.rejects(
        pool.query(
          `UPDATE report_card_schema_versions SET status = 'DRAFT' WHERE schema_id = $1 AND version = 2`,
          [created.schema.id]
        ),
        (err) => String(err.message).includes("REPORT_CARD_SCHEMA_VERSION_IMMUTABLE")
      );
    } finally {
      await pool.end();
    }
  });

  test("pg: historical version delete rejected", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const { store, schoolA } = await boot(pool);
      const created = await store.createSchema({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaKey: "core",
        spec: spec(),
        activate: true,
      });
      const v2 = await store.addVersion({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaId: created.schema.id,
        spec: spec(),
      });
      await store.activateVersion({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        schemaId: created.schema.id,
        version: v2.version,
      });
      await pool.query(
        `UPDATE report_card_schema_versions SET status = 'ARCHIVED' WHERE schema_id = $1 AND version = 1`,
        [created.schema.id]
      );
      await assert.rejects(
        pool.query(`DELETE FROM report_card_schema_versions WHERE schema_id = $1 AND version = 1`, [created.schema.id]),
        (err) => String(err.message).includes("REPORT_CARD_SCHEMA_VERSION_IMMUTABLE")
      );
      const still = await pool.query(
        `SELECT status FROM report_card_schema_versions WHERE schema_id = $1 AND version = 1`,
        [created.schema.id]
      );
      assert.equal(still.rowCount, 1);
      assert.equal(still.rows[0].status, "ARCHIVED");
    } finally {
      await pool.end();
    }
  });
});
