"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { PUBLISH } = require("../../contracts/reportCard/contract");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);
if (process.env.CI && !shouldRun) {
  throw new Error("DATABASE_URL + pg requis en CI pour report-card-publication PG");
}

const IT_DB = String(process.env.SOMAFRIK_REPORT_CARD_PUBLICATION_IT_DATABASE ?? "somafrik_report_card_publication_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function loadLot4Pg() {
  try {
    return {
      sql: require("../../db/reportCardPublicationSql").REPORT_CARD_PUBLICATION_SQL,
      createStore: require("../../db/reportCardPublicationPgStore").createReportCardPublicationPgStore,
      createPublication: require("./reportCardPublication").createReportCardPublication,
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

function payload(schoolId, overrides = {}) {
  return {
    report_card_id: "rc-pg-1",
    published_snapshot_version: 1,
    school_id: schoolId,
    published_at: "2026-09-13T00:00:00.000Z",
    engine_id: "somafrik.report_card.v1",
    provenance: { profile: { id: "P", version: 1, spec_sha256: "aa" }, schema: { id: "S", version: 1, spec_sha256: "bb" } },
    students: [{ student_id: "STU-1", cells: [], slots: [], presence: [] }],
    ...overrides,
  };
}

async function boot(pool) {
  const lot4 = loadLot4Pg();
  assert.ok(lot4, "LOT 4 PG store/DDL missing (RED)");
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
  await pool.query(lot4.sql);
  const signingKey = generateSigningKey("rc-ed25519-1");
  const wrapping = generateWrappingKey("rc-wrap-1");
  const store = lot4.createStore(pool);
  const publication = lot4.createPublication({
    signingKey,
    wrapping,
    wrappingKeys: [wrapping],
    signingKeys: [signingKey],
    store,
  });
  return {
    publication,
    store,
    schoolA,
    schoolB,
    tenantA: { schoolId: schoolA, actorSchoolId: schoolA },
    tenantB: { schoolId: schoolB, actorSchoolId: schoolB },
  };
}

describe("report-card-publication PG atomic/idempotent/isolation", { skip: !shouldRun }, () => {
  test("pg: atomic parts, idempotence, concurrency, immutability, tenant", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      const { publication, schoolA, tenantA, tenantB } = await boot(pool);
      const first = await publication.publish({ tenant: tenantA, payload: payload(schoolA) });
      assert.equal(first.status, "PUBLISHED");
      assert.equal(first.verification_status, "ACTIVE");
      const retry = await publication.publish({ tenant: tenantA, payload: payload(schoolA) });
      assert.equal(retry.public_id, first.public_id);
      const outbox = await publication.listOutbox({ tenant: tenantA });
      assert.equal(outbox.length, 1);
      assert.equal(outbox[0].event, PUBLISH.outbox_event);

      await assert.rejects(
        () => publication.publish({ tenant: tenantA, payload: payload(schoolA, { students: [] }) }),
        (err) => err.code === "IDEMPOTENCY_CONFLICT"
      );
      assert.equal((await publication.listOutbox({ tenant: tenantA })).length, 1);

      const raced = await Promise.all([
        publication.publish({ tenant: tenantA, payload: payload(schoolA) }),
        publication.publish({ tenant: tenantA, payload: payload(schoolA) }),
      ]);
      assert.equal(raced[0].public_id, first.public_id);
      assert.equal(raced[1].public_id, first.public_id);

      await assert.rejects(
        () =>
          pool.query("UPDATE report_card_published_snapshots SET snapshot_sha256 = $1 WHERE public_id = $2", [
            "0".repeat(64),
            first.public_id,
          ]),
        (err) => /PUBLICATION_IMMUTABLE/i.test(String(err.message))
      );

      await assert.rejects(
        () => publication.payloadForRender({ tenant: tenantB, reportCardId: "rc-pg-1", version: 1 }),
        (err) => err.code === "TENANT_MISMATCH" || err.code === "PUBLICATION_NOT_FOUND"
      );

      const v2 = await publication.publish({
        tenant: tenantA,
        payload: payload(schoolA, { published_snapshot_version: 2, published_at: "2026-09-13T01:00:00.000Z" }),
      });
      assert.notEqual(v2.public_id, first.public_id);
      const url1 = await publication.reprintUrl({ tenant: tenantA, reportCardId: "rc-pg-1", version: 1 });
      const url2 = await publication.reprintUrl({ tenant: tenantA, reportCardId: "rc-pg-1", version: 2 });
      assert.notEqual(url1, url2);
    } finally {
      await pool.end();
    }
  });
});
