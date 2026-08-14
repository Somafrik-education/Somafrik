"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { createResidualPgStore } = require("../db/residualPgStore");
const { createBackOfficeStateWriteRemovedError } = require("./backofficeStateRemoval");

const DATABASE_URL = process.env.DATABASE_URL;
const shouldRun = Boolean(DATABASE_URL);

test("persistance résiduelle PG sans lecture backoffice_state", { skip: !shouldRun }, async () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const repo = {
    pool,
    async query(sql, params) {
      return pool.query(sql, params);
    },
    async one(sql, params) {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    async all(sql, params) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async getSchoolByCode(code) {
      return this.one(`SELECT * FROM schools WHERE school_code = $1`, [code]);
    },
  };

  const { RESIDUAL_STATE_SCHEMA_SQL } = require("../db/residualStateSchema");
  await repo.query(RESIDUAL_STATE_SCHEMA_SQL);

  const school = await repo.getSchoolByCode("CD-2026-0001");
  if (school) {
    const store = createResidualPgStore(repo);
    const saved = await store.saveAcademicConfig(school.school_code, {
      schoolCode: school.school_code,
    });
    assert.equal(saved.schoolCode, school.school_code);
    const projection = await store.listProjection();
    assert.ok(projection.academicConfigs[school.school_code]);
    assert.deepEqual(projection.exams, []);
    assert.deepEqual(projection.bulletins, []);
    assert.deepEqual(projection.documents, []);

    await assert.rejects(
      () => store.replaceDomainRecords("exam", school.school_code, [{ id: "EXAM-PG-CD" }]),
      (error) => error.code === "LEGACY_EXAMS_WRITE_FORBIDDEN" && error.statusCode === 400,
    );
  }

  await pool.end();
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
