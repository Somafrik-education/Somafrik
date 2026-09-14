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
  throw new Error("DATABASE_URL + pg requis en CI pour report-card-lot10 PG");
}

function loadLot10() {
  try {
    return require("./reportCardQualification");
  } catch {
    return null;
  }
}

describe("report-card-lot10 PG qualification", { skip: !shouldRun }, () => {
  test("pg: production initial publish of qualification A stamps class/year from classes", async () => {
    const lot10 = loadLot10();
    assert.ok(lot10 && typeof lot10.publishQualificationPg === "function", "RED: reportCardQualification PG helper missing");
    const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    try {
      const published = await lot10.publishQualificationPg(pool, lot10.QUALIFICATION_A);
      assert.ok(published.payload.academic_year_id);
      assert.ok(published.payload.class_id);
      assert.equal(published.payload.engine_id, require("../../contracts/reportCard/contract").ENGINE_ID);
    } finally {
      await pool.end();
    }
  });
});
