"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { ACADEMIC_RULE_PROFILE_SCHEMA_SQL } = require("../../db/academicRuleProfileSchema");
const { REPORT_CARD_SCHEMA_SQL } = require("../../db/reportCardSchemaSql");
const { REPORT_CARD_CONFIGURATION_SQL } = require("../../db/reportCardConfigurationSql");
const { REPORT_CARD_SOURCE_ARTIFACT_SQL } = require("../../db/reportCardSourceArtifactSql");
const { createAcademicRuleProfilePgStore } = require("../../db/academicRuleProfilePgStore");
const { createReportCardSchemaPgStore } = require("../../db/reportCardSchemaPgStore");
const { createReportCardConfigurationPgStore } = require("../../db/reportCardConfigurationPgStore");
const { createReportCardSourceArtifactPgStore } = require("../../db/reportCardSourceArtifactPgStore");
const { createReportCardConfiguration } = require("./reportCardConfiguration");
const { createReportCardSourceArtifact } = require("./reportCardSourceArtifact");
const { createMemorySourceStorage } = require("./reportCardSourceStorage");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);
if (process.env.CI && !shouldRun) {
  throw new Error("DATABASE_URL + pg requis en CI pour report-card-lot11 PG");
}

const IT_DB = String(process.env.SOMAFRIK_REPORT_CARD_LOT11_IT_DATABASE ?? "somafrik_report_card_lot11_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const SCHOOL_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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

function calculableProfile() {
  return {
    period_mode: "term",
    periods: ["T1", "T2", "T3"],
    annual: true,
    score_components: [
      { id: "TJ", applicability: "always", max: 20, coefficient: 2 },
      { id: "EX", applicability: "per_subject", max: 20 },
    ],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up", stage: "display_only" },
    aggregation: {
      mode: "weighted_sum",
      coefficient_default: 1,
      percentage: "points_over_max_100",
    },
    ranking: { enabled: true, ties: "competition", metric: "PERCENTAGE" },
    pass_rule: { metric: "PERCENTAGE", threshold: 50 },
  };
}

function compatibleSchema() {
  return {
    sections: [
      {
        id: "IDENTITY",
        order: 1,
        kind: "identity",
        columns: [{ id: "STUDENT_NAME", order: 1, kind: "identity" }],
      },
      {
        id: "SUBJECTS",
        order: 2,
        kind: "subject_rows",
        rows: [{ id: "SUBJECT_LINE", order: 1, kind: "subject" }],
        columns: [
          { id: "COL_TJ", order: 1, kind: "score_component", score_component_id: "TJ" },
          { id: "COL_EX", order: 2, kind: "score_component", score_component_id: "EX" },
        ],
      },
    ],
    identity_fields: [{ id: "STUDENT_NAME", order: 1 }],
    metadata_fields: [{ id: "SCHOOL_YEAR", order: 1 }],
  };
}

function validTemplate() {
  return {
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: [
      { id: "SUMMARY", order: 1, label: "Totaux", source: "slots" },
      { id: "SUBJECTS", order: 2, label: "Disciplines", source: "cells" },
      { id: "APPLICABILITY", order: 3, label: "Presence", source: "presence" },
    ],
  };
}

function schoolSubmit(schoolId = SCHOOL_A) {
  return {
    actorId: `submit-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SUBMIT_MODEL"],
  };
}

function superadmin() {
  return {
    actorId: "superadmin-pg-lot11",
    permissions: ["REPORT_CARD_CONFIGURE"],
    platform: { privileged: true },
  };
}

function pdfBytes(marker = "lot11-pg") {
  return Buffer.from(`%PDF-1.4\n%${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
}

function wrapFailSaveMapping(store) {
  async function fail() {
    const err = new Error("injected-fail-after-bind-before-pin");
    err.code = "INJECTED_FAIL";
    throw err;
  }
  return {
    ...store,
    saveMapping: fail,
    async withTx(fn) {
      return store.withTx(async (tx) => {
        return fn({
          ...tx,
          saveMapping: fail,
        });
      });
    },
  };
}

function wrapFailBetweenArchiveAndCreate(store) {
  return {
    ...store,
    async withTx(fn) {
      return store.withTx(async (tx) => {
        let saves = 0;
        const wrapped = {
          ...tx,
          async save(artifact) {
            saves += 1;
            if (saves >= 2) {
              const err = new Error("injected-fail-between-archive-and-create");
              err.code = "INJECTED_FAIL";
              throw err;
            }
            return tx.save(artifact);
          },
        };
        return fn(wrapped);
      });
    },
  };
}

async function openLot11Pg() {
  const url = await ensureIsolatedDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: url, max: 8 });
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query(`
    CREATE TABLE schools (
      id UUID PRIMARY KEY,
      school_code TEXT UNIQUE
    )
  `);
  await pool.query("INSERT INTO schools (id, school_code) VALUES ($1, 'A')", [SCHOOL_A]);
  await pool.query(ACADEMIC_RULE_PROFILE_SCHEMA_SQL);
  await pool.query(REPORT_CARD_SCHEMA_SQL);
  await pool.query(REPORT_CARD_CONFIGURATION_SQL);
  await pool.query(REPORT_CARD_SOURCE_ARTIFACT_SQL);

  const profileStore = createAcademicRuleProfilePgStore(pool);
  const schemaStore = createReportCardSchemaPgStore(pool);
  const persistence = createReportCardConfigurationPgStore(pool);
  const configuration = createReportCardConfiguration({
    profileStore,
    schemaStore,
    persistence,
    clock: { now: () => new Date().toISOString() },
  });
  const storage = createMemorySourceStorage();
  const submitted = await configuration.submitModel({
    actor: schoolSubmit(),
    schoolId: SCHOOL_A,
    modelKey: "trimestriel",
    description: "lot11 pg",
  });
  return { pool, profileStore, schemaStore, configuration, storage, requestId: submitted.id };
}

function createArtifactService(configuration, storage, pool) {
  return createReportCardSourceArtifact({
    configuration,
    storage,
    metadata: createReportCardSourceArtifactPgStore(pool),
    clock: { now: () => new Date().toISOString() },
  });
}

async function mapAttached(ctx, artifacts, attached) {
  await ctx.configuration.startReview({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  await ctx.configuration.startConfiguring({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
  });
  const profile = await ctx.profileStore.createProfile({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    profileKey: `p-lot11-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    spec: calculableProfile(),
    activate: true,
  });
  const schema = await ctx.schemaStore.createSchema({
    schoolId: SCHOOL_A,
    actorSchoolId: SCHOOL_A,
    schemaKey: `s-lot11-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    spec: compatibleSchema(),
    activate: true,
  });
  const template = await ctx.configuration.saveRenderingTemplate({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    spec: validTemplate(),
  });
  await artifacts.mapExplicit({
    actor: superadmin(),
    schoolId: SCHOOL_A,
    requestId: ctx.requestId,
    profile: { id: profile.profile.id, version: profile.version.version },
    schema: { id: schema.schema.id, version: schema.version.version },
    template: { id: template.template_id, version: template.version },
    artifact_id: attached.artifact_id,
    artifact_version: attached.version,
  });
  return { profile, schema, template };
}

describe("report-card-lot11 PG transactional replace + mapping audit", { skip: !shouldRun }, () => {
  test("report-card-lot11-replace-concurrency-one-current", async () => {
    const ctx = await openLot11Pg();
    try {
      const first = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      await first.attachToRequest({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("base"),
        declaredMime: "application/pdf",
        originalFilename: "base.pdf",
        idempotencyKey: "cmd-base",
      });

      const instanceA = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const instanceB = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const raced = await Promise.allSettled([
        instanceA.replaceCurrent({
          actor: schoolSubmit(),
          schoolId: SCHOOL_A,
          requestId: ctx.requestId,
          bytes: pdfBytes("c1"),
          declaredMime: "application/pdf",
          originalFilename: "c1.pdf",
          idempotencyKey: "cmd-c1",
        }),
        instanceB.replaceCurrent({
          actor: schoolSubmit(),
          schoolId: SCHOOL_A,
          requestId: ctx.requestId,
          bytes: pdfBytes("c2"),
          declaredMime: "application/pdf",
          originalFilename: "c2.pdf",
          idempotencyKey: "cmd-c2",
        }),
      ]);
      assert.equal(raced.filter((row) => row.status === "fulfilled").length >= 1, true);
      const currents = await ctx.pool.query(
        `SELECT id, version FROM report_card_source_artifacts
         WHERE school_id = $1 AND request_id = $2 AND current`,
        [SCHOOL_A, ctx.requestId]
      );
      assert.equal(currents.rowCount, 1);
      const current = await first.getCurrent({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      assert.equal(current.artifact_id, currents.rows[0].id);
      assert.equal(current.current, true);
    } finally {
      await ctx.pool.end();
    }
  });

  test("report-card-lot11-replace-failure-keeps-current", async () => {
    const ctx = await openLot11Pg();
    try {
      const healthy = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const attached = await healthy.attachToRequest({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("keep"),
        declaredMime: "application/pdf",
        originalFilename: "keep.pdf",
        idempotencyKey: "cmd-keep",
      });
      const blobsBefore = ctx.storage.blobs.size;
      const failingStore = wrapFailBetweenArchiveAndCreate(createReportCardSourceArtifactPgStore(ctx.pool));
      const failing = createReportCardSourceArtifact({
        configuration: ctx.configuration,
        storage: ctx.storage,
        metadata: failingStore,
        clock: { now: () => new Date().toISOString() },
      });
      await assert.rejects(
        () =>
          failing.replaceCurrent({
            actor: schoolSubmit(),
            schoolId: SCHOOL_A,
            requestId: ctx.requestId,
            bytes: pdfBytes("boom"),
            declaredMime: "application/pdf",
            originalFilename: "boom.pdf",
            idempotencyKey: "cmd-boom",
          }),
        (err) => err && err.code === "INJECTED_FAIL"
      );
      const current = await healthy.getCurrent({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      assert.equal(current.artifact_id, attached.artifact_id);
      assert.equal(current.current, true);
      assert.equal(current.status, "CURRENT");
      const currents = await ctx.pool.query(
        `SELECT id FROM report_card_source_artifacts
         WHERE school_id = $1 AND request_id = $2 AND current`,
        [SCHOOL_A, ctx.requestId]
      );
      assert.equal(currents.rowCount, 1);
      assert.equal(currents.rows[0].id, attached.artifact_id);
      assert.equal(ctx.storage.blobs.size, blobsBefore);
      assert.equal(ctx.storage.blobs.has(attached.storage_key), true);
    } finally {
      await ctx.pool.end();
    }
  });

  test("report-card-lot11-mapping-explicit-audit-persists-bundle-refs", async () => {
    const ctx = await openLot11Pg();
    try {
      const artifacts = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const attached = await artifacts.attachToRequest({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("map"),
        declaredMime: "application/pdf",
        originalFilename: "map.pdf",
        idempotencyKey: "cmd-map",
      });
      await ctx.configuration.startReview({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      await ctx.configuration.startConfiguring({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      const profile = await ctx.profileStore.createProfile({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        profileKey: `p-lot11-${Date.now()}`,
        spec: calculableProfile(),
        activate: true,
      });
      const schema = await ctx.schemaStore.createSchema({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        schemaKey: `s-lot11-${Date.now()}`,
        spec: compatibleSchema(),
        activate: true,
      });
      const template = await ctx.configuration.saveRenderingTemplate({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        spec: validTemplate(),
      });
      const mapped = await artifacts.mapExplicit({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        profile: { id: profile.profile.id, version: profile.version.version },
        schema: { id: schema.schema.id, version: schema.version.version },
        template: { id: template.template_id, version: template.version },
        artifact_id: attached.artifact_id,
        artifact_version: attached.version,
      });
      const audit = await artifacts.listAudit({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      const row = audit.find((item) => item.action === "MAP_EXPLICIT");
      assert.ok(row, "MAP_EXPLICIT audit row missing");
      assert.equal(row.artifact_id, attached.artifact_id);
      assert.equal(row.artifact_sha256, attached.sha256);
      assert.equal(row.artifact_version, attached.version);
      assert.equal(row.profile_id, mapped.request.profile_id);
      assert.equal(row.profile_version, mapped.request.profile_version);
      assert.equal(row.profile_spec_sha256, mapped.request.profile_spec_sha256);
      assert.equal(row.schema_id, mapped.request.schema_id);
      assert.equal(row.schema_version, mapped.request.schema_version);
      assert.equal(row.schema_spec_sha256, mapped.request.schema_spec_sha256);
      assert.equal(row.template_id, mapped.request.rendering_template_id);
      assert.equal(row.template_version, mapped.request.rendering_template_version);
      assert.equal(row.template_spec_sha256, mapped.request.rendering_template_spec_sha256);
      const joined = await ctx.pool.query(
        `SELECT a.artifact_id, a.artifact_sha256, a.artifact_version,
                a.profile_id, a.profile_version, a.profile_spec_sha256,
                a.schema_id, a.schema_version, a.schema_spec_sha256,
                a.template_id, a.template_version, a.template_spec_sha256,
                r.profile_id AS req_profile_id,
                r.profile_version AS req_profile_version,
                r.profile_spec_sha256 AS req_profile_sha,
                r.schema_id AS req_schema_id,
                r.schema_version AS req_schema_version,
                r.schema_spec_sha256 AS req_schema_sha,
                r.rendering_template_id AS req_template_id,
                r.rendering_template_version AS req_template_version,
                r.rendering_template_spec_sha256 AS req_template_sha
         FROM report_card_source_artifact_audit a
         JOIN report_card_configuration_requests r
           ON r.id = a.request_id AND r.school_id = a.school_id
         WHERE a.action = 'MAP_EXPLICIT'
           AND a.request_id = $1
           AND a.school_id = $2
           AND a.artifact_id = $3
           AND a.artifact_sha256 = $4`,
        [ctx.requestId, SCHOOL_A, attached.artifact_id, attached.sha256]
      );
      assert.equal(joined.rowCount, 1);
      assert.equal(joined.rows[0].profile_id, joined.rows[0].req_profile_id);
      assert.equal(Number(joined.rows[0].profile_version), Number(joined.rows[0].req_profile_version));
      assert.equal(joined.rows[0].profile_spec_sha256, joined.rows[0].req_profile_sha);
      assert.equal(joined.rows[0].schema_id, joined.rows[0].req_schema_id);
      assert.equal(Number(joined.rows[0].schema_version), Number(joined.rows[0].req_schema_version));
      assert.equal(joined.rows[0].schema_spec_sha256, joined.rows[0].req_schema_sha);
      assert.equal(joined.rows[0].template_id, joined.rows[0].req_template_id);
      assert.equal(Number(joined.rows[0].template_version), Number(joined.rows[0].req_template_version));
      assert.equal(joined.rows[0].template_spec_sha256, joined.rows[0].req_template_sha);
      const pin = await ctx.pool.query(
        `SELECT artifact_id, artifact_sha256, artifact_version, valid
         FROM report_card_source_artifact_mapping
         WHERE school_id = $1 AND request_id = $2`,
        [SCHOOL_A, ctx.requestId]
      );
      assert.equal(pin.rowCount, 1);
      assert.equal(pin.rows[0].valid, true);
      assert.equal(pin.rows[0].artifact_id, attached.artifact_id);
      assert.equal(pin.rows[0].artifact_sha256, attached.sha256);
    } finally {
      await ctx.pool.end();
    }
  });

  test("report-card-lot11-map-replace-ready-requires-remap", async () => {
    const ctx = await openLot11Pg();
    try {
      const artifacts = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const first = await artifacts.attachToRequest({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("v1"),
        declaredMime: "application/pdf",
        originalFilename: "v1.pdf",
        idempotencyKey: "cmd-v1",
      });
      const bundle = await mapAttached(ctx, artifacts, first);
      const second = await artifacts.replaceCurrent({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("v2"),
        declaredMime: "application/pdf",
        originalFilename: "v2.pdf",
        idempotencyKey: "cmd-v2",
      });
      await assert.rejects(
        () =>
          artifacts.markReadyForReview({
            actor: superadmin(),
            schoolId: SCHOOL_A,
            requestId: ctx.requestId,
          }),
        (err) => err && (err.code === "MAPPING_REQUIRED" || err.code === "HASH_MISMATCH")
      );
      const pin = await ctx.pool.query(
        `SELECT valid, artifact_id FROM report_card_source_artifact_mapping
         WHERE school_id = $1 AND request_id = $2`,
        [SCHOOL_A, ctx.requestId]
      );
      assert.equal(pin.rows[0].valid, false);
      await artifacts.mapExplicit({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        profile: { id: bundle.profile.profile.id, version: bundle.profile.version.version },
        schema: { id: bundle.schema.schema.id, version: bundle.schema.version.version },
        template: { id: bundle.template.template_id, version: bundle.template.version },
        artifact_id: second.artifact_id,
        artifact_version: second.version,
      });
      const ready = await artifacts.markReadyForReview({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      assert.equal(ready.status, "READY_FOR_REVIEW");
      assert.equal(ready.artifact_id, second.artifact_id);
    } finally {
      await ctx.pool.end();
    }
  });

  test("report-card-lot11-replace-ready-race-no-post-ready-replace", async () => {
    const ctx = await openLot11Pg();
    try {
      const mappedSvc = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const first = await mappedSvc.attachToRequest({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("race-v1"),
        declaredMime: "application/pdf",
        originalFilename: "race-v1.pdf",
        idempotencyKey: "cmd-race-v1",
      });
      await mapAttached(ctx, mappedSvc, first);
      const replacer = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const reader = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const raced = await Promise.allSettled([
        replacer.replaceCurrent({
          actor: schoolSubmit(),
          schoolId: SCHOOL_A,
          requestId: ctx.requestId,
          bytes: pdfBytes("race-v2"),
          declaredMime: "application/pdf",
          originalFilename: "race-v2.pdf",
          idempotencyKey: "cmd-race-v2",
        }),
        reader.markReadyForReview({
          actor: superadmin(),
          schoolId: SCHOOL_A,
          requestId: ctx.requestId,
        }),
      ]);
      const request = await ctx.pool.query(
        `SELECT status FROM report_card_configuration_requests WHERE id = $1 AND school_id = $2`,
        [ctx.requestId, SCHOOL_A]
      );
      const current = await ctx.pool.query(
        `SELECT id, sha256, version FROM report_card_source_artifacts
         WHERE school_id = $1 AND request_id = $2 AND current`,
        [SCHOOL_A, ctx.requestId]
      );
      const pin = await ctx.pool.query(
        `SELECT valid, artifact_id, artifact_sha256 FROM report_card_source_artifact_mapping
         WHERE school_id = $1 AND request_id = $2`,
        [SCHOOL_A, ctx.requestId]
      );
      assert.equal(current.rowCount, 1);
      assert.equal(pin.rowCount, 1);
      const status = request.rows[0].status;
      if (status === "READY_FOR_REVIEW") {
        assert.equal(current.rows[0].id, first.artifact_id);
        assert.equal(pin.rows[0].valid, true);
        assert.equal(pin.rows[0].artifact_id, first.artifact_id);
        const replaceResult = raced[0];
        assert.equal(replaceResult.status, "rejected");
        await assert.rejects(
          () =>
            replacer.replaceCurrent({
              actor: schoolSubmit(),
              schoolId: SCHOOL_A,
              requestId: ctx.requestId,
              bytes: pdfBytes("race-v3"),
              declaredMime: "application/pdf",
              originalFilename: "race-v3.pdf",
              idempotencyKey: "cmd-race-v3",
            }),
          (err) => err && err.code === "ARTIFACT_IMMUTABLE"
        );
      } else {
        assert.equal(status, "CONFIGURING");
        const readyResult = raced[1];
        assert.equal(readyResult.status, "rejected");
        if (String(current.rows[0].id) !== String(first.artifact_id)) {
          assert.equal(pin.rows[0].valid, false);
        }
      }
    } finally {
      await ctx.pool.end();
    }
  });

  test("report-card-lot11-bind-without-pin-ready-forbidden", async () => {
    const ctx = await openLot11Pg();
    try {
      const healthy = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const attached = await healthy.attachToRequest({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("pin-fail"),
        declaredMime: "application/pdf",
        originalFilename: "pin-fail.pdf",
        idempotencyKey: "cmd-pin-fail",
      });
      await ctx.configuration.startReview({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      await ctx.configuration.startConfiguring({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      const profile = await ctx.profileStore.createProfile({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        profileKey: `p-fail-${Date.now()}`,
        spec: calculableProfile(),
        activate: true,
      });
      const schema = await ctx.schemaStore.createSchema({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        schemaKey: `s-fail-${Date.now()}`,
        spec: compatibleSchema(),
        activate: true,
      });
      const template = await ctx.configuration.saveRenderingTemplate({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        spec: validTemplate(),
      });
      const failing = createReportCardSourceArtifact({
        configuration: ctx.configuration,
        storage: ctx.storage,
        metadata: wrapFailSaveMapping(createReportCardSourceArtifactPgStore(ctx.pool)),
        clock: { now: () => new Date().toISOString() },
      });
      await assert.rejects(
        () =>
          failing.mapExplicit({
            actor: superadmin(),
            schoolId: SCHOOL_A,
            requestId: ctx.requestId,
            profile: { id: profile.profile.id, version: profile.version.version },
            schema: { id: schema.schema.id, version: schema.version.version },
            template: { id: template.template_id, version: template.version },
            artifact_id: attached.artifact_id,
            artifact_version: attached.version,
          }),
        (err) => err && err.code === "INJECTED_FAIL"
      );
      const bound = await ctx.configuration.getRequest({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      assert.equal(bound.profile_id, profile.profile.id);
      const pin = await ctx.pool.query(
        `SELECT valid FROM report_card_source_artifact_mapping
         WHERE school_id = $1 AND request_id = $2`,
        [SCHOOL_A, ctx.requestId]
      );
      assert.equal(pin.rowCount === 0 || pin.rows[0].valid === false, true);
      await assert.rejects(
        () =>
          healthy.markReadyForReview({
            actor: superadmin(),
            schoolId: SCHOOL_A,
            requestId: ctx.requestId,
          }),
        (err) => err && err.code === "MAPPING_REQUIRED"
      );
    } finally {
      await ctx.pool.end();
    }
  });

  test("report-card-lot11-rebind-same-artifact-ready-requires-remap", async () => {
    const ctx = await openLot11Pg();
    try {
      const artifacts = createArtifactService(ctx.configuration, ctx.storage, ctx.pool);
      const attached = await artifacts.attachToRequest({
        actor: schoolSubmit(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        bytes: pdfBytes("rebind"),
        declaredMime: "application/pdf",
        originalFilename: "rebind.pdf",
        idempotencyKey: "cmd-rebind",
      });
      const first = await mapAttached(ctx, artifacts, attached);
      const profileY = await ctx.profileStore.createProfile({
        schoolId: SCHOOL_A,
        actorSchoolId: SCHOOL_A,
        profileKey: `p-y-${Date.now()}`,
        spec: calculableProfile(),
        activate: true,
      });
      await ctx.configuration.bindBundle({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        profile: { id: profileY.profile.id, version: profileY.version.version },
        schema: { id: first.schema.schema.id, version: first.schema.version.version },
        template: { id: first.template.template_id, version: first.template.version },
      });
      await assert.rejects(
        () =>
          artifacts.markReadyForReview({
            actor: superadmin(),
            schoolId: SCHOOL_A,
            requestId: ctx.requestId,
          }),
        (err) => err && err.code === "MAPPING_REQUIRED"
      );
      await artifacts.mapExplicit({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
        profile: { id: profileY.profile.id, version: profileY.version.version },
        schema: { id: first.schema.schema.id, version: first.schema.version.version },
        template: { id: first.template.template_id, version: first.template.version },
        artifact_id: attached.artifact_id,
        artifact_version: attached.version,
      });
      const ready = await artifacts.markReadyForReview({
        actor: superadmin(),
        schoolId: SCHOOL_A,
        requestId: ctx.requestId,
      });
      assert.equal(ready.status, "READY_FOR_REVIEW");
      assert.equal(ready.profile_id, profileY.profile.id);
      const pin = await ctx.pool.query(
        `SELECT profile_id, valid FROM report_card_source_artifact_mapping
         WHERE school_id = $1 AND request_id = $2`,
        [SCHOOL_A, ctx.requestId]
      );
      assert.equal(pin.rows[0].valid, true);
      assert.equal(pin.rows[0].profile_id, profileY.profile.id);
    } finally {
      await ctx.pool.end();
    }
  });
});
