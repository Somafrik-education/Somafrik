"use strict";

/**
 * CARTE-BATCH-API-02 — le socle des cartes s'initialise sans `classes`.
 * Les lots ne sont créés qu'ensuite, avec leurs contraintes tenant et leur index unique.
 */

const assert = require("node:assert/strict");
const { Pool } = require("pg");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL } = require("../db/studentAccessCardsSchema");
const { ensureStudentCardBatchesSchema } = require("../db/studentCardBatchesSchema");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DATABASE = String(process.env.SOMAFRIK_CARD_BATCH_SCHEMA_IT_DATABASE ?? "somafrik_carte_batch_schema_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

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

function adapter(pool) {
  return {
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
  };
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentCardBatches.schema.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  assertDisposableTarget(DATABASE_URL);
  const isolatedUrl = await ensureIsolatedDatabase(DATABASE_URL, IT_DATABASE);
  assertDisposableTarget(isolatedUrl);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query(`
      CREATE TABLE schools (id UUID PRIMARY KEY);
      CREATE TABLE users (id UUID PRIMARY KEY);
      CREATE TABLE students (
        id UUID PRIMARY KEY,
        school_id UUID NOT NULL REFERENCES schools(id),
        student_code TEXT,
        status TEXT
      );
    `);
    await pool.query(STUDENT_ACCESS_CARDS_SCHEMA_SQL);
    const before = await pool.query("SELECT to_regclass('public.student_card_batches') AS ref");
    assert.equal(before.rows[0].ref, null);
    await assert.rejects(
      () => ensureStudentCardBatchesSchema(adapter(pool)),
      (error) => error.code === "STUDENT_CARD_BATCHES_SCHEMA_PREFLIGHT",
    );
    const stillAbsent = await pool.query("SELECT to_regclass('public.student_card_batches') AS ref");
    assert.equal(stillAbsent.rows[0].ref, null);

    await pool.query(`
      CREATE TABLE classes (
        id UUID PRIMARY KEY,
        school_id UUID NOT NULL REFERENCES schools(id),
        class_code TEXT NOT NULL
      );
    `);
    await ensureStudentCardBatchesSchema(adapter(pool));
    await ensureStudentCardBatchesSchema(adapter(pool));

    const constraints = await pool.query(`
      SELECT conname
        FROM pg_constraint
       WHERE conrelid IN ('public.student_card_batches'::regclass, 'public.student_card_batch_items'::regclass)
    `);
    const names = new Set(constraints.rows.map((row) => row.conname));
    for (const name of [
      "student_card_batches_status_check",
      "student_card_batches_nonce_hash_check",
      "student_card_batches_phase_check",
      "student_card_batches_class_id_fkey",
      "student_card_batch_items_outcome_check",
      "student_card_batch_items_batch_student_key",
      "student_card_batch_items_student_tenant_fk",
      "student_card_batch_items_card_tenant_fk",
    ]) {
      assert.equal(names.has(name), true, name);
    }
    const indexes = await pool.query(`
      SELECT indexname
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('student_card_batches_one_open_per_class', 'idx_student_card_batches_school_open')
    `);
    assert.equal(indexes.rowCount, 2);

    const schoolId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const studentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
    const classId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
    const missingClassId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
    await pool.query("INSERT INTO schools (id) VALUES ($1)", [schoolId]);
    await pool.query("INSERT INTO users (id) VALUES ($1)", [userId]);
    await pool.query(
      "INSERT INTO students (id, school_id, student_code, status) VALUES ($1, $2, 'STU', 'active')",
      [studentId, schoolId],
    );
    await pool.query(
      "INSERT INTO classes (id, school_id, class_code) VALUES ($1, $2, 'SCHEMA-A')",
      [classId, schoolId],
    );
    const hash = "a".repeat(64);
    await assert.rejects(
      () => pool.query(
        `INSERT INTO student_card_batches (school_id, class_id, class_code, status, expires_at, delivery_nonce_hash)
         VALUES ($1, $2, 'ABSENT', 'prepared', NOW() + INTERVAL '30 minutes', $3)`,
        [schoolId, missingClassId, hash],
      ),
      (error) => error.code === "23503",
    );
    const batch = await pool.query(
      `INSERT INTO student_card_batches (school_id, class_id, class_code, status, expires_at, delivery_nonce_hash, created_by_user_id)
       VALUES ($1, $2, 'SCHEMA-A', 'prepared', NOW() + INTERVAL '30 minutes', $3, $4)
       RETURNING id`,
      [schoolId, classId, hash, userId],
    );
    await assert.rejects(
      () => pool.query(
        `INSERT INTO student_card_batches (school_id, class_id, class_code, status, expires_at, delivery_nonce_hash)
         VALUES ($1, $2, 'SCHEMA-A', 'prepared', NOW() + INTERVAL '30 minutes', $3)`,
        [schoolId, classId, "b".repeat(64)],
      ),
      (error) => error.code === "23505",
    );
    const card = await pool.query(
      `INSERT INTO student_access_cards (school_id, student_id, public_id, token_hash, medium, status)
       VALUES ($1, $2, 'pub-schema', $3, 'qr', 'issued')
       RETURNING id`,
      [schoolId, studentId, "c".repeat(64)],
    );
    await pool.query(
      `INSERT INTO student_card_batch_items (batch_id, school_id, student_id, card_id, outcome)
       VALUES ($1, $2, $3, $4, 'prepared')`,
      [batch.rows[0].id, schoolId, studentId, card.rows[0].id],
    );
    await assert.rejects(
      () => pool.query(
        `INSERT INTO student_card_batch_items (batch_id, school_id, student_id, card_id, outcome)
         VALUES ($1, $2, $3, $4, 'prepared')`,
        [batch.rows[0].id, schoolId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1", card.rows[0].id],
      ),
      (error) => error.code === "23503",
    );
    console.log("studentCardBatches.schema.pg.test.js PASS");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
