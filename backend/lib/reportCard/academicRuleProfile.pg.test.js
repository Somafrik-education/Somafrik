"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { ACADEMIC_RULE_PROFILE_SCHEMA_SQL } = require("../../db/academicRuleProfileSchema");
const { createAcademicRuleProfilePgStore } = require("../../db/academicRuleProfilePgStore");
const { AcademicRuleProfileError } = require("./academicRuleProfile");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
let Pool = null;
try {
  ({ Pool } = require("pg"));
} catch {
  Pool = null;
}
const shouldRun = Boolean(DATABASE_URL && Pool);
if (process.env.CI && !shouldRun) {
  throw new Error("DATABASE_URL + pg requis en CI pour academic-rule-profile PG");
}

const IT_DB = String(process.env.SOMAFRIK_ACADEMIC_RULE_PROFILE_IT_DATABASE ?? "somafrik_academic_rule_profile_it")
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

function spec() {
  return {
    periods: ["T1", "T2"],
    score_components: [{ id: "TJ", applicability: "always", max: 20 }],
    missing_score: "NOT_APPLICABLE_not_zero",
    rounding: { decimals: 2, mode: "half_up" },
    ranking: { enabled: true, ties: "competition" },
  };
}

describe("academic-rule-profile PG constraints/versioning/isolation", { skip: !shouldRun }, () => {
  test("pg: tenant isolation, versioning, immutable spec", async () => {
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

      const store = createAcademicRuleProfilePgStore(pool);
      const created = await store.createProfile({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        profileKey: "core",
        spec: spec(),
        activate: true,
      });
      const v2 = await store.addVersion({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        profileId: created.profile.id,
        spec: spec(),
      });
      await store.activateVersion({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        profileId: created.profile.id,
        version: v2.version,
      });
      const active = await store.getActive({
        schoolId: schoolA,
        actorSchoolId: schoolA,
        profileId: created.profile.id,
      });
      assert.equal(active.version, 2);

      await assert.rejects(
        () =>
          store.updateDraftSpec({
            schoolId: schoolA,
            actorSchoolId: schoolA,
            profileId: created.profile.id,
            version: 1,
            spec: spec(),
          }),
        (err) => err.code === "VERSION_IMMUTABLE" || err instanceof AcademicRuleProfileError
      );

      const steal = await store.listProfiles(schoolB, schoolB);
      assert.equal(steal.length, 0);
      await assert.rejects(
        () =>
          store.getActive({
            schoolId: schoolB,
            actorSchoolId: schoolB,
            profileId: created.profile.id,
          }),
        (err) => err.code === "PROFILE_NOT_FOUND"
      );

      await assert.rejects(
        () => store.getActive({ schoolId: schoolA, profileId: created.profile.id }),
        (err) => err.code === "TENANT_REQUIRED"
      );
      await assert.rejects(
        () => store.listProfiles(schoolA),
        (err) => err.code === "TENANT_REQUIRED"
      );
      await assert.rejects(
        () =>
          store.addVersion({
            schoolId: schoolA,
            actorSchoolId: schoolB,
            profileId: created.profile.id,
            spec: spec(),
          }),
        (err) => err.code === "TENANT_MISMATCH"
      );

      const concurrent = await Promise.all([
        store.addVersion({
          schoolId: schoolA,
          actorSchoolId: schoolA,
          profileId: created.profile.id,
          spec: spec(),
        }),
        store.addVersion({
          schoolId: schoolA,
          actorSchoolId: schoolA,
          profileId: created.profile.id,
          spec: spec(),
        }),
      ]);
      assert.deepEqual(new Set(concurrent.map((row) => row.version)), new Set([3, 4]));

      await assert.rejects(
        pool.query(
          `UPDATE academic_rule_profile_versions SET spec = '{"hack":true}'::jsonb WHERE profile_id = $1 AND version = 1`,
          [created.profile.id]
        ),
        (err) => String(err.message).includes("ACADEMIC_RULE_PROFILE_VERSION_IMMUTABLE")
      );

      const superseded = await pool.query(
        `SELECT status FROM academic_rule_profile_versions WHERE profile_id = $1 AND version = 1`,
        [created.profile.id]
      );
      const currentActive = await pool.query(
        `SELECT status FROM academic_rule_profile_versions WHERE profile_id = $1 AND version = 2`,
        [created.profile.id]
      );
      assert.equal(superseded.rows[0].status, "SUPERSEDED");
      assert.equal(currentActive.rows[0].status, "ACTIVE");

      await assert.rejects(
        pool.query(
          `UPDATE academic_rule_profile_versions SET status = 'DRAFT' WHERE profile_id = $1 AND version = 1`,
          [created.profile.id]
        ),
        (err) => String(err.message).includes("ACADEMIC_RULE_PROFILE_VERSION_IMMUTABLE")
      );
      await assert.rejects(
        pool.query(
          `UPDATE academic_rule_profile_versions SET status = 'DRAFT' WHERE profile_id = $1 AND version = 2`,
          [created.profile.id]
        ),
        (err) => String(err.message).includes("ACADEMIC_RULE_PROFILE_VERSION_IMMUTABLE")
      );

      const afterReopenAttempt = await pool.query(
        `SELECT version, status FROM academic_rule_profile_versions
         WHERE profile_id = $1 AND version IN (1, 2) ORDER BY version`,
        [created.profile.id]
      );
      assert.deepEqual(
        afterReopenAttempt.rows.map((row) => ({ version: Number(row.version), status: row.status })),
        [
          { version: 1, status: "SUPERSEDED" },
          { version: 2, status: "ACTIVE" },
        ]
      );

      await assert.rejects(
        pool.query(
          `UPDATE academic_rule_profile_versions SET spec = '{"hack":true}'::jsonb WHERE profile_id = $1 AND version = 1`,
          [created.profile.id]
        ),
        (err) => String(err.message).includes("ACADEMIC_RULE_PROFILE_VERSION_IMMUTABLE")
      );
    } finally {
      await pool.end();
    }
  });
});
