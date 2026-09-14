"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { generateSigningKey } = require("../../contracts/reportCard/snapshot");
const { generateWrappingKey } = require("../../contracts/reportCard/verificationSecret");
const { createReportCardCorrection } = require("./reportCardCorrection");
const { validateSpec: validateProfileSpec } = require("./academicRuleProfile");
const { validateSpec: validateSchemaSpec } = require("./reportCardSchema");
const { computeReportCard } = require("./reportCardEngine");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);
if (process.env.CI && !shouldRun) {
  throw new Error("DATABASE_URL + pg requis en CI pour report-card-lot9 PG");
}

const IT_DB = String(process.env.SOMAFRIK_REPORT_CARD_LOT9_IT_DATABASE ?? "somafrik_report_card_lot9_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

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

function profileSpec() {
  return validateProfileSpec({
    periods: ["T1", "T2"],
    annual: true,
    score_components: [{ id: "TJ", applicability: "always", max: 20, coefficient: 1 }],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: false, ties: "competition" },
  });
}

function schemaSpec() {
  return validateSchemaSpec({
    sections: [
      {
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        columns: [
          {
            id: "COL_T1_TJ",
            order: 1,
            kind: "score_component",
            score_component_id: "TJ",
            period_id: "T1",
          },
        ],
      },
    ],
  });
}

function payload(schoolId, version = 1) {
  const result = computeReportCard({
    profile: profileSpec(),
    schema: schemaSpec(),
    facts: [
      {
        student_id: "STU-1",
        subject_id: "MATH",
        period_id: "T1",
        score_component_id: "TJ",
        raw_score: 12,
        subject_applicable: true,
      },
    ],
    provenance: {
      profile: { id: "P", version: 1, spec_sha256: "aa" },
      schema: { id: "S", version: 1, spec_sha256: "bb" },
    },
    tenant: { schoolId, actorSchoolId: schoolId },
  });
  return {
    report_card_id: "rc-lot9-1",
    published_snapshot_version: version,
    school_id: schoolId,
    published_at: "2026-09-14T00:00:00.000Z",
    engine_id: result.engine_id,
    provenance: result.provenance,
    students: result.students,
  };
}

describe("report-card-lot9 PG correction/revoke serialization", { skip: !shouldRun }, () => {
  test("pg: concurrent correct vs revoke is deterministic and never corrects a revoked source", async () => {
    const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
    const pool = new Pool({ connectionString: url, max: 8 });
    try {
      await pool.query("DROP SCHEMA public CASCADE");
      await pool.query("CREATE SCHEMA public");
      await pool.query(`
        CREATE TABLE schools (
          id UUID PRIMARY KEY,
          school_code TEXT UNIQUE
        )
      `);
      const schoolA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      await pool.query("INSERT INTO schools (id, school_code) VALUES ($1, 'A')", [schoolA]);
      const sql = require("../../db/reportCardPublicationSql").REPORT_CARD_PUBLICATION_SQL;
      await pool.query(sql);
      const signingKey = generateSigningKey("rc-ed25519-1");
      const wrapping = generateWrappingKey("rc-wrap-1");
      const { createReportCardPublicationPgStore } = require("../../db/reportCardPublicationPgStore");
      const { createReportCardPublication } = require("./reportCardPublication");
      const store = createReportCardPublicationPgStore(pool);
      const publication = createReportCardPublication({
        signingKey,
        wrapping,
        wrappingKeys: [wrapping],
        signingKeys: [signingKey],
        store,
      });
      const tenant = { schoolId: schoolA, actorSchoolId: schoolA };
      await publication.publish({ tenant, payload: payload(schoolA) });
      const correction = createReportCardCorrection({
        publication,
        getFacts: async () => [
          {
            student_id: "STU-1",
            subject_id: "MATH",
            period_id: "T1",
            score_component_id: "TJ",
            raw_score: 16,
            subject_applicable: true,
          },
        ],
        getProfile: async () => profileSpec(),
        getSchema: async () => schemaSpec(),
      });
      const actor = { actorId: "pg-actor" };
      const results = await Promise.allSettled([
        correction.correct({
          tenant,
          actor,
          reportCardId: "rc-lot9-1",
          sourceVersion: 1,
          reason: "Concurrent correct",
          commandId: "cmd-pg-c",
        }),
        publication.revoke({
          tenant,
          reportCardId: "rc-lot9-1",
          version: 1,
          reason: "Concurrent revoke",
          actorId: "pg-actor",
        }),
      ]);
      const fulfilled = results.filter((row) => row.status === "fulfilled");
      const rejected = results.filter((row) => row.status === "rejected");
      assert.equal(fulfilled.length >= 1, true);
      const v1 = await publication.lookup({ tenant, reportCardId: "rc-lot9-1", version: 1 });
      let v2 = null;
      try {
        v2 = await publication.lookup({ tenant, reportCardId: "rc-lot9-1", version: 2 });
      } catch {
        v2 = null;
      }
      if (v2) {
        assert.equal(v2.verification_status, "ACTIVE");
        assert.notEqual(v1.verification_status, "ACTIVE");
        assert.equal(Number(v2.corrected_from_version), 1);
      } else {
        assert.equal(v1.verification_status, "REVOKED");
        assert.equal(rejected.length >= 1, true);
      }
      const current = await publication.listCurrent({ tenant });
      assert.equal(current.filter((row) => row.report_card_id === "rc-lot9-1").length <= 1, true);
      if (current.length === 1) {
        assert.equal(current[0].verification_status, "ACTIVE");
        assert.notEqual(v1.verification_status, "ACTIVE");
      }
    } finally {
      await pool.end();
    }
  });
});
