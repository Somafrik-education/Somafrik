"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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

const CATALOG_DIR = path.join(__dirname, "qualification");

function loadLot10() {
  try {
    return require("./reportCardQualification");
  } catch {
    return null;
  }
}

function loadPgSupport() {
  try {
    return require("./reportCardLot10.pg.support");
  } catch {
    return null;
  }
}

function catalogFileFor(id) {
  for (const name of fs.readdirSync(CATALOG_DIR)) {
    if (!name.endsWith(".json")) continue;
    const abs = path.join(CATALOG_DIR, name);
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (raw && raw.id === id) return abs;
  }
  return null;
}

function loadStaticGolden(id) {
  const catalogFile = catalogFileFor(id);
  assert.ok(catalogFile, `RED: catalog fixture missing for ${id}`);
  const expectedFile = path.join(CATALOG_DIR, "expected", path.basename(catalogFile));
  assert.equal(fs.existsSync(expectedFile), true, `RED: static golden missing ${expectedFile}`);
  const golden = JSON.parse(fs.readFileSync(expectedFile, "utf8"));
  assert.ok(
    golden.snapshot && Array.isArray(golden.snapshot.students) && golden.snapshot.students.length > 0,
    `RED: golden.snapshot required ${expectedFile}`
  );
  return golden;
}

describe("report-card-lot10 PG qualification", { skip: !shouldRun }, () => {
  test("pg: production module does not export destructive harness", () => {
    const lot10 = loadLot10();
    assert.ok(lot10);
    assert.equal(typeof lot10.publishQualificationPg, "undefined");
    const src = fs.readFileSync(path.join(__dirname, "reportCardQualification.js"), "utf8");
    assert.doesNotMatch(src, /DROP SCHEMA/);
    assert.doesNotMatch(src, /CREATE DATABASE/);
    const support = loadPgSupport();
    assert.ok(support && typeof support.publishQualificationPg === "function", "RED: test-only PG support missing");
  });

  test("pg: production initial publish of qualifications A and B stamps class/year from classes", async () => {
    const lot10 = loadLot10();
    const support = loadPgSupport();
    assert.ok(lot10 && support && typeof support.publishQualificationPg === "function", "RED: test-only PG support missing");
    const { ENGINE_ID } = require("../../contracts/reportCard/contract");
    const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    try {
      const published = [];
      for (const id of [lot10.QUALIFICATION_A, lot10.QUALIFICATION_B]) {
        const golden = loadStaticGolden(id);
        const result = await support.publishQualificationPg(pool, id);
        assert.ok(result.payload.academic_year_id);
        assert.ok(result.payload.class_id);
        assert.equal(result.payload.engine_id, ENGINE_ID);
        assert.deepEqual(lot10.canonicalResult(result.payload), golden.canonical);
        assert.equal(typeof lot10.normalizePublishedSnapshot, "function", "RED: normalizePublishedSnapshot missing");
        assert.deepEqual(lot10.normalizePublishedSnapshot(result.payload), golden.snapshot);
        published.push(result);
      }
      assert.notEqual(published[0].payload.class_id, published[1].payload.class_id);
      assert.notEqual(
        require("../../contracts/reportCard/jcs").canonicalize(lot10.canonicalResult(published[0].payload)),
        require("../../contracts/reportCard/jcs").canonicalize(lot10.canonicalResult(published[1].payload))
      );
    } finally {
      await pool.end();
    }
  });
});
