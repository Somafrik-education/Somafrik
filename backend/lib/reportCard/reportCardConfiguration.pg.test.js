"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { ACADEMIC_RULE_PROFILE_SCHEMA_SQL } = require("../../db/academicRuleProfileSchema");
const { REPORT_CARD_SCHEMA_SQL } = require("../../db/reportCardSchemaSql");
const { createAcademicRuleProfilePgStore } = require("../../db/academicRuleProfilePgStore");
const { createReportCardSchemaPgStore } = require("../../db/reportCardSchemaPgStore");
const { ENGINE_ID } = require("../../contracts/reportCard/contract");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);
if (process.env.CI && !shouldRun) {
  throw new Error("DATABASE_URL + pg requis en CI pour report-card-configuration PG");
}

const IT_DB = String(process.env.SOMAFRIK_REPORT_CARD_CONFIGURATION_IT_DATABASE ?? "somafrik_report_card_configuration_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function loadLot6Pg() {
  try {
    return {
      sql: require("../../db/reportCardConfigurationSql").REPORT_CARD_CONFIGURATION_SQL,
      createStore: require("../../db/reportCardConfigurationPgStore").createReportCardConfigurationPgStore,
      createConfiguration: require("./reportCardConfiguration").createReportCardConfiguration,
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
        id: "SUBJECTS",
        order: 1,
        kind: "subject_rows",
        columns: [
          { id: "COL_TJ", order: 1, kind: "score_component", score_component_id: "TJ" },
          { id: "COL_T1", order: 2, kind: "period", period_id: "T1" },
        ],
      },
    ],
  };
}

function validTemplate() {
  return {
    paper: "A4",
    orientation: "portrait",
    qr_required: true,
    sections: [{ id: "SUBJECTS", order: 1, label: "Disciplines", source: "cells" }],
  };
}

function schoolSubmit(schoolId) {
  return {
    actorId: `submit-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SUBMIT_MODEL"],
  };
}

function schoolApprove(schoolId) {
  return {
    actorId: `approve-${schoolId}`,
    actorSchoolId: schoolId,
    permissions: ["REPORT_CARD_SCHOOL_APPROVE_TEMPLATE"],
  };
}

function superadmin() {
  return {
    actorId: "superadmin-pg",
    permissions: ["REPORT_CARD_CONFIGURE"],
    platform: { privileged: true },
  };
}

async function seedApproved(api, profileStore, schemaStore, schoolId, modelKey) {
  const profile = await profileStore.createProfile({
    schoolId,
    actorSchoolId: schoolId,
    profileKey: `p-${modelKey}-${Math.random().toString(16).slice(2)}`,
    spec: calculableProfile(),
    activate: true,
  });
  const schema = await schemaStore.createSchema({
    schoolId,
    actorSchoolId: schoolId,
    schemaKey: `s-${modelKey}-${Math.random().toString(16).slice(2)}`,
    spec: compatibleSchema(),
    activate: true,
  });
  const submitted = await api.submitModel({
    actor: schoolSubmit(schoolId),
    schoolId,
    modelKey,
    description: "pg",
  });
  await api.startReview({ actor: superadmin(), schoolId, requestId: submitted.id });
  await api.startConfiguring({ actor: superadmin(), schoolId, requestId: submitted.id });
  const template = await api.saveRenderingTemplate({
    actor: superadmin(),
    schoolId,
    requestId: submitted.id,
    spec: validTemplate(),
  });
  await api.bindBundle({
    actor: superadmin(),
    schoolId,
    requestId: submitted.id,
    profile: { id: profile.profile.id, version: profile.version.version },
    schema: { id: schema.schema.id, version: schema.version.version },
    template: { id: template.template_id, version: template.version },
  });
  await api.markReadyForReview({ actor: superadmin(), schoolId, requestId: submitted.id });
  await api.approve({ actor: schoolApprove(schoolId), schoolId, requestId: submitted.id });
  return submitted.id;
}

describe("report-card-configuration PG atomic/idempotent/isolation", { skip: !shouldRun }, () => {
  test("report-card-lot6-concurrent-activation-one-active", async () => {
    const lot6 = loadLot6Pg();
    assert.ok(lot6 && lot6.sql && lot6.createStore && lot6.createConfiguration, "LOT 6 PG store/DDL missing (RED)");
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
      const schoolB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      await pool.query("INSERT INTO schools (id, school_code) VALUES ($1, 'A'), ($2, 'B')", [schoolA, schoolB]);
      await pool.query(ACADEMIC_RULE_PROFILE_SCHEMA_SQL);
      await pool.query(REPORT_CARD_SCHEMA_SQL);
      await pool.query(lot6.sql);

      const version = await pool.query("SHOW server_version");
      assert.match(String(version.rows[0].server_version), /^16\./);

      const profileStore = createAcademicRuleProfilePgStore(pool);
      const schemaStore = createReportCardSchemaPgStore(pool);
      const persistence = lot6.createStore(pool);
      const api = lot6.createConfiguration({
        profileStore,
        schemaStore,
        persistence,
        clock: { now: () => new Date().toISOString() },
      });

      const firstId = await seedApproved(api, profileStore, schemaStore, schoolA, "concurrent");
      const secondId = await seedApproved(api, profileStore, schemaStore, schoolA, "concurrent");
      const raced = await Promise.allSettled([
        api.activate({ actor: superadmin(), schoolId: schoolA, requestId: firstId, commandId: "c-1" }),
        api.activate({ actor: superadmin(), schoolId: schoolA, requestId: secondId, commandId: "c-2" }),
      ]);
      assert.equal(raced.filter((row) => row.status === "fulfilled").length >= 1, true);
      const actives = await pool.query(
        `SELECT id, status FROM report_card_configuration_requests
         WHERE school_id = $1 AND model_key = $2 AND status = 'ACTIVE'`,
        [schoolA, "concurrent"]
      );
      assert.equal(actives.rowCount, 1);
      const binding = await pool.query(
        `SELECT request_id, engine_id FROM report_card_active_bindings
         WHERE school_id = $1 AND model_key = $2`,
        [schoolA, "concurrent"]
      );
      assert.equal(binding.rowCount, 1);
      assert.equal(binding.rows[0].engine_id, ENGINE_ID);
      assert.equal(binding.rows[0].request_id, actives.rows[0].id);

      const retry = await api.activate({
        actor: superadmin(),
        schoolId: schoolA,
        requestId: actives.rows[0].id,
        commandId: actives.rows[0].id === firstId ? "c-1" : "c-2",
      });
      assert.equal(retry.status, "ACTIVE");
      assert.equal(retry.id, actives.rows[0].id);

      await assert.rejects(
        () =>
          api.getRequest({
            actor: schoolSubmit(schoolB),
            schoolId: schoolB,
            requestId: actives.rows[0].id,
          }),
        (err) => err && (err.code === "REQUEST_NOT_FOUND" || err.code === "TENANT_MISMATCH")
      );

      await assert.rejects(
        () => pool.query("DELETE FROM report_card_configuration_audit"),
        (err) => /AUDIT_IMMUTABLE/i.test(String(err.message))
      );
      await assert.rejects(
        () => pool.query("UPDATE report_card_configuration_audit SET reason = 'mut'"),
        (err) => /AUDIT_IMMUTABLE/i.test(String(err.message))
      );

      const templateRow = await pool.query(
        `SELECT id, version, spec_sha256, status FROM report_card_rendering_template_versions LIMIT 1`
      );
      assert.ok(templateRow.rowCount >= 1);
      await assert.rejects(
        () =>
          pool.query("UPDATE report_card_rendering_template_versions SET spec_sha256 = $1 WHERE id = $2", [
            "0".repeat(64),
            templateRow.rows[0].id,
          ]),
        (err) => /VERSION_IMMUTABLE|RENDERING_TEMPLATE.*IMMUTABLE/i.test(String(err.message))
      );
    } finally {
      await pool.end();
    }
  });
});
