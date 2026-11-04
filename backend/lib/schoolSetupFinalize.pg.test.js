"use strict";

/**
 * CONFIG-FINAL-01 — persistance PostgreSQL de finalized_at.
 * Exécuté sur une base jetable. Un SKIP n'est pas une validation.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { ensureSchoolSetupGuidedSchema } = require("../db/schoolSetupGuidedSchema");
const {
  createPgProgressStore,
  finalizeSchoolSetupGuided,
  getSchoolSetupGuided,
  completeGuidedStep,
} = require("./schoolSetupGuided");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_SCHOOL_SETUP_FINALIZE_IT_DATABASE ?? "somafrik_school_setup_finalize_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

const SCHOOL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SCHOOL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

function assertDisposableTarget(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Refus: hôte PostgreSQL non local (${host}).`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (/prod|preprod/i.test(`${host} ${name} ${IT_DATABASE}`)) {
    throw new Error("Refus: cible prod ou préprod.");
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

function membershipOne() {
  return async (sql, params = []) => {
    const text = String(sql);
    if (/from\s+users/i.test(text) && /school_id/i.test(text)) {
      if (String(params[0]) === "admin-a") return { school_id: SCHOOL_A, login_code: "CD-IN-26-001", id: SCHOOL_A };
      if (String(params[0]) === "admin-b") return { school_id: SCHOOL_B, login_code: "CD-EL-26-002", id: SCHOOL_B };
    }
    return null;
  };
}

function readySnapshot(overrides = {}) {
  return {
    hasName: true,
    hasCountry: true,
    hasAddress: true,
    hasPhone: true,
    hasCurrency: true,
    hasCurrentOrOpenAcademicYear: true,
    hasAcademicYearDates: true,
    activatedLevelCount: 1,
    activatedGroupCount: 1,
    classCount: 1,
    subjectCount: 1,
    teacherCount: 1,
    teacherAssignmentCount: 1,
    enrolledStudentCount: 1,
    feeGridCount: 0,
    paymentMethodCount: 0,
    evaluationTypeCount: 0,
    notificationsConfigured: false,
    userCount: 1,
    ...overrides,
  };
}

test("PostgreSQL conserve la finalisation après reconnexion et ne la réinitialise pas", async (t) => {
  if (process.env.GITHUB_ACTIONS && !DATABASE_URL) {
    throw new Error("DATABASE_URL requis en GitHub Actions — la persistance ne peut pas être SKIP.");
  }
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL requis — un test PostgreSQL ignoré ne valide pas CONFIG-FINAL-01.");
  }
  assertDisposableTarget(DATABASE_URL);
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  assertDisposableTarget(isolatedUrl);

  const pool = new Pool({ connectionString: isolatedUrl });
  let writes = 0;
  const query = async (sql, params) => {
    if (/^\s*(insert|update)\b/i.test(String(sql))) writes += 1;
    return pool.query(sql, params);
  };
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null;
  const store = createPgProgressStore(one, query);

  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("CREATE TABLE schools (id UUID PRIMARY KEY)");
    await pool.query(`
      CREATE TABLE school_setup_progress (
        school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
        last_valid_step INTEGER NOT NULL DEFAULT 0,
        completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT school_setup_progress_last_valid_step_check
          CHECK (last_valid_step >= 0 AND last_valid_step <= 10)
      )
    `);
    const before = await pool.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'school_setup_progress' AND column_name = 'finalized_at'
    `);
    assert.equal(before.rowCount, 0);
    await ensureSchoolSetupGuidedSchema({ query: (sql, params) => pool.query(sql, params) });
    await ensureSchoolSetupGuidedSchema({ query: (sql, params) => pool.query(sql, params) });
    const after = await pool.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_name = 'school_setup_progress' AND column_name = 'finalized_at'
    `);
    assert.equal(after.rowCount, 1);
    assert.equal(after.rows[0].is_nullable, "YES");
    const statusColumn = await pool.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'school_setup_progress' AND column_name = 'setup_status'
    `);
    assert.equal(statusColumn.rowCount, 0);

    await pool.query("INSERT INTO schools (id) VALUES ($1), ($2)", [SCHOOL_A, SCHOOL_B]);
    const baseInput = {
      one: membershipOne(),
      progressStore: store,
      loadSnapshot: async () => readySnapshot(),
    };

    writes = 0;
    const first = await finalizeSchoolSetupGuided({
      ...baseInput,
      principal: { role: "Admin School", sub: "admin-a", permissions: ["Paramètres Établissement:UPDATE"] },
      body: { schoolId: SCHOOL_B },
    });
    assert.equal(first.finalized, true);
    assert.equal(first.schoolId, SCHOOL_A);
    assert.equal(writes, 1);

    const stored = await pool.query(
      "SELECT finalized_at, completed_steps FROM school_setup_progress WHERE school_id = $1",
      [SCHOOL_A],
    );
    assert.equal(stored.rowCount, 1);
    assert.ok(stored.rows[0].finalized_at);
    const other = await pool.query("SELECT 1 FROM school_setup_progress WHERE school_id = $1", [SCHOOL_B]);
    assert.equal(other.rowCount, 0);

    writes = 0;
    const second = await finalizeSchoolSetupGuided({
      ...baseInput,
      principal: { role: "Admin School", sub: "admin-a", permissions: ["Paramètres Établissement:UPDATE"] },
    });
    assert.equal(writes, 0);
    assert.equal(new Date(second.finalizedAt).getTime(), new Date(first.finalizedAt).getTime());
    const storedAgain = await pool.query(
      "SELECT finalized_at FROM school_setup_progress WHERE school_id = $1",
      [SCHOOL_A],
    );
    assert.equal(storedAgain.rows[0].finalized_at.toISOString(), stored.rows[0].finalized_at.toISOString());

    await pool.end();
    const restarted = new Pool({ connectionString: isolatedUrl });
    try {
      const survived = await restarted.query(
        "SELECT finalized_at FROM school_setup_progress WHERE school_id = $1",
        [SCHOOL_A],
      );
      assert.equal(survived.rows[0].finalized_at.toISOString(), stored.rows[0].finalized_at.toISOString());
      const restartedStore = createPgProgressStore(
        async (sql, params) => (await restarted.query(sql, params)).rows[0] ?? null,
        (sql, params) => restarted.query(sql, params),
      );
      const reloaded = await getSchoolSetupGuided({
        principal: { role: "Admin School", sub: "admin-a", permissions: ["Paramètres Établissement:READ", "Paramètres Établissement:UPDATE"] },
        one: membershipOne(),
        progressStore: restartedStore,
        loadSnapshot: async () => readySnapshot({ classCount: 0, enrolledStudentCount: 0 }),
      });
      assert.equal(reloaded.finalized, true);
      assert.equal(new Date(reloaded.finalizedAt).getTime(), stored.rows[0].finalized_at.getTime());

      const kept = await completeGuidedStep({
        principal: { role: "Admin School", sub: "admin-a", permissions: ["Paramètres Établissement:UPDATE"] },
        stepKey: "establishment",
        one: membershipOne(),
        progressStore: restartedStore,
        loadSnapshot: async () => readySnapshot(),
      });
      assert.equal(kept.finalized, true);
      const afterEdit = await restarted.query(
        "SELECT finalized_at FROM school_setup_progress WHERE school_id = $1",
        [SCHOOL_A],
      );
      assert.equal(afterEdit.rows[0].finalized_at.toISOString(), stored.rows[0].finalized_at.toISOString());
      const stillOther = await restarted.query("SELECT 1 FROM school_setup_progress WHERE school_id = $1", [SCHOOL_B]);
      assert.equal(stillOther.rowCount, 0);
    } finally {
      await restarted.end();
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
  t.diagnostic("finalized_at survit à une nouvelle connexion PostgreSQL");
});
