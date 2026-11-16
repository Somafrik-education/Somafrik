"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createResidualPgStore } = require("../db/residualPgStore");
const { createBackOfficeStateWriteRemovedError } = require("./backofficeStateRemoval");

const DATABASE_URL = process.env.DATABASE_URL;
const shouldRun = Boolean(DATABASE_URL);

test("persistance résiduelle PG sans lecture backoffice_state", { skip: !shouldRun }, async () => {
  // This test must not depend on schemas/seeds accidentally left by previous
  // commands in Full regression. All fixture DDL + data live in one transaction.
  const { randomUUID } = require("node:crypto");
  const { assertDisposableLocalDatabaseUrl } = require("./disposableTestDatabaseGuard");
  assertDisposableLocalDatabaseUrl(DATABASE_URL);
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  const schema = `residual_it_${randomUUID().replace(/-/g, "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`CREATE TABLE schools (
      id UUID PRIMARY KEY,
      school_code VARCHAR(32) NOT NULL UNIQUE
    )`);
    const { RESIDUAL_STATE_SCHEMA_SQL } = require("../db/residualStateSchema");
    await client.query(RESIDUAL_STATE_SCHEMA_SQL);
    const fixtureId = randomUUID();
    await client.query("INSERT INTO schools (id, school_code) VALUES ($1, $2)", [fixtureId, "CD-2026-0001"]);

    const repo = {
      pool,
      async query(sql, params) {
        return client.query(sql, params);
      },
      async one(sql, params) {
        const result = await client.query(sql, params);
        return result.rows[0] ?? null;
      },
      async all(sql, params) {
        const result = await client.query(sql, params);
        return result.rows;
      },
      async getSchoolByCode(code) {
        return this.one("SELECT * FROM schools WHERE school_code = $1", [code]);
      },
    };

    const store = createResidualPgStore(repo);
    const saved = await store.saveAcademicConfig("CD-2026-0001", { schoolCode: "CD-2026-0001" });
    assert.equal(saved.schoolCode, "CD-2026-0001");
    const projection = await store.listProjection();
    assert.ok(projection.academicConfigs["CD-2026-0001"]);
    assert.deepEqual(projection.exams, []);
    assert.deepEqual(projection.bulletins, []);
    assert.deepEqual(projection.documents, []);

    await assert.rejects(
      () => store.replaceDomainRecords("exam", "CD-2026-0001", [{ id: "EXAM-PG-CD" }]),
      (error) => error.code === "LEGACY_EXAMS_WRITE_FORBIDDEN" && error.statusCode === 400,
    );
  } finally {
    // Transaction rollback also removes the fixture schema and its tables.
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  }
});

test("saveBackOfficeState rejette toute écriture snapshot", () => {
  const error = createBackOfficeStateWriteRemovedError();
  assert.equal(error.code, "BACKOFFICE_STATE_WRITE_REMOVED");
  assert.equal(error.statusCode, 410);
});

test("recordResidualReplace refuse exam/bulletin/document", async () => {
  const { recordResidualReplace } = require("./residualStateManagement");
  await assert.rejects(
    () => recordResidualReplace({}, "exam", "CD-2026-0001", [], { schoolCode: "CD-2026-0001" }, {}),
    (error) => error.code === "LEGACY_EXAMS_WRITE_FORBIDDEN",
  );
});
