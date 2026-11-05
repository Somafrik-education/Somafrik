"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createReportCardCatalogPgStore } = require("../../db/reportCardCatalogPgStore");

test("le catalogue scolaire propose exclusivement les périodes de l'année scolaire courante", async () => {
  const sqls = [];
  const pool = {
    async query(sql, params) {
      const statement = String(sql);
      sqls.push(statement);
      assert.deepEqual(params, ["school-test"]);
      if (statement.includes("FROM terms t")) {
        assert.match(statement, /y\.school_id::text = \$1\s+AND y\.is_current = TRUE/);
        assert.doesNotMatch(statement, /ORDER BY y\.is_current DESC/);
        return { rows: [{ name: "Trimestre 1" }, { name: "Trimestre 2" }, { name: "Trimestre 3" }] };
      }
      return { rows: [] };
    },
  };
  const store = createReportCardCatalogPgStore(pool);
  const ctx = await store.schoolContext("school-test");
  assert.deepEqual(ctx.terms, ["Trimestre 1", "Trimestre 2", "Trimestre 3"]);
  assert.equal(sqls.length, 3);
  assert.equal(sqls.filter((sql) => sql.includes("FROM terms t")).length, 1);
});

test("aucune période d'une année ancienne n'est inventée si l'année courante n'a pas de trimestres", async () => {
  const store = createReportCardCatalogPgStore({
    async query(sql) {
      if (String(sql).includes("FROM terms t")) {
        assert.match(String(sql), /y\.is_current = TRUE/);
      }
      return { rows: [] };
    },
  });
  const ctx = await store.schoolContext("school-test");
  assert.deepEqual(ctx.terms, []);
});
