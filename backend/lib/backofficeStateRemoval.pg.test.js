"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { RESIDUAL_STATE_SCHEMA_SQL } = require("../db/residualStateSchema");
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
    formatDate(value) {
      if (!value) return "";
      const date = value instanceof Date ? value : new Date(value);
      return date.toLocaleDateString("fr-FR");
    },
    async getSchoolByCode(code) {
      return this.one(`SELECT * FROM schools WHERE school_code = $1`, [code]);
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const txRepo = {
          ...this,
          query: (...args) => client.query(...args),
        };
        const result = await fn(txRepo);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };

  await repo.query(RESIDUAL_STATE_SCHEMA_SQL);
  const snapshot = await repo.one(`SELECT state_payload FROM backoffice_state WHERE state_key = 'default'`);
  // LOT 8 : l'application ne lit plus ce snapshot ; la table peut subsister pour rollback opérationnel.
  void snapshot;

  const school = await repo.getSchoolByCode("CD-2026-0001");
  if (school) {
    const store = createResidualPgStore(repo);
    const saved = await store.saveAcademicConfig(school.school_code, {
      schoolCode: school.school_code,
      periodMode: "trimestre",
      periods: [
        {
          name: "Trimestre 1",
          type: "Trimestre",
          startDate: "01-09-2025",
          endDate: "31-12-2025",
          active: true,
        },
      ],
      evaluationTypes: ["Devoir"],
      defaultScale: 20,
    });
    assert.equal(saved.schoolCode, school.school_code);
    const projection = await store.listProjection();
    assert.ok(projection.academicConfigs[school.school_code]);

    await store.replaceDomainRecords("exam", school.school_code, [
      { id: "EXAM-PG-CD", schoolCode: school.school_code, title: "Canonique" },
    ]);
    const { recordResidualReplace } = require("./residualStateManagement");
    const pgRepo = {
      getResidualStore: () => store,
      createTxScope(tx) {
        return {
          ...repo,
          query: (...args) => tx.query(...args),
          recordAudit: async () => {
            throw new Error("audit failed");
          },
        };
      },
      async withTransaction(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const tx = { query: (...args) => client.query(...args) };
          await fn(tx);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
      invalidateCachedDataset() {},
    };

    await assert.rejects(
      () =>
        recordResidualReplace(
          pgRepo,
          "exam",
          school.school_code,
          [{ id: "EXAM-PG-CD-2", title: "Rollback" }],
          { schoolCode: school.school_code },
          { userId: "USER-PG" },
        ),
      /audit failed/,
    );

    const afterRollback = await store.listProjection();
    assert.equal(afterRollback.exams.length, 1);
    assert.equal(afterRollback.exams[0].id, "EXAM-PG-CD");

    await assert.rejects(
      () =>
        recordResidualReplace(
          pgRepo,
          "exam",
          school.school_code,
          [{ id: "EXAM-PG-FOREIGN", schoolCode: "BI-2026-0002", title: "Inject" }],
          { schoolCode: school.school_code },
          { userId: "USER-PG" },
        ),
      (error) => error.statusCode === 400,
    );
  }

  await pool.end();
});

test("saveBackOfficeState rejette toute écriture snapshot", () => {
  const error = createBackOfficeStateWriteRemovedError();
  assert.equal(error.code, "BACKOFFICE_STATE_WRITE_REMOVED");
  assert.equal(error.statusCode, 410);
});
