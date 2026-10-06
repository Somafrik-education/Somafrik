"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL } = require("../db/studentAccessCardsSchema");
const { createStudentAccessCardsPgStore } = require("../db/studentAccessCardsPgStore");
const {
  STUDENT_CARD_ERROR,
  generateCardSecrets,
  issueStudentCard,
  listStudentCards,
  markStudentCardLost,
  revokeStudentCard,
  replaceStudentCard,
  sanitizeAuditValue,
  assertNoSecretLeak,
} = require("./studentAccessCardsManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_STUDENT_CARDS_LIFECYCLE_IT_DATABASE ?? "somafrik_student_cards_lifecycle_it")
  .trim()
  .replace(/[^a-zA-Z0-9_]/g, "");

function withDatabaseName(databaseUrl, databaseName) {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function ensureDatabase(databaseUrl, databaseName) {
  const pool = new Pool({ connectionString: withDatabaseName(databaseUrl, "postgres") });
  try {
    const existing = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (!existing.rowCount) await pool.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await pool.end();
  }
  return withDatabaseName(databaseUrl, databaseName);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

async function expectHttp(fn, status, code) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.statusCode, status, `${code}: status ${error.statusCode} ${error.message}`);
    assert.equal(error.code, code, `${code}: code ${error.code}`);
    return error;
  }
  assert.fail(`${code}: aurait dû être rejeté`);
}

function createRepo(pool, audits) {
  const repo = {
    engine: "postgresql",
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    async withTransaction(fn) {
      const client = await pool.connect();
      const tx = {
        query: (sql, params) => client.query(sql, params),
        one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null,
        all: async (sql, params) => (await client.query(sql, params)).rows,
      };
      try {
        await client.query("BEGIN");
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* keep original */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    getStudentAccessCardsStore() {
      return createStudentAccessCardsPgStore(this);
    },
    getSchoolSettingsStore() {
      return {
        getSettings: (schoolId) => repo.one(`SELECT * FROM school_settings WHERE school_id = $1`, [schoolId]),
      };
    },
    async recordAudit(payload) {
      const cleaned = {
        ...payload,
        oldValue: sanitizeAuditValue(payload.oldValue),
        newValue: sanitizeAuditValue(payload.newValue),
      };
      assertNoSecretLeak(cleaned.newValue, "audit.newValue");
      assertNoSecretLeak(cleaned.oldValue, "audit.oldValue");
      audits.push(cleaned);
      await pool.query(
        `INSERT INTO audit_logs (school_id, user_id, action, entity_type, entity_id, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          null,
          null,
          payload.action,
          payload.entityType,
          payload.entityId ?? null,
          payload.oldValue ? JSON.stringify(sanitizeAuditValue(payload.oldValue)) : null,
          payload.newValue ? JSON.stringify(sanitizeAuditValue(payload.newValue)) : null,
        ],
      );
    },
  };
  return repo;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentAccessCards.lifecycle.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }

  const isolatedUrl = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  const audits = [];
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await pool.query(`
      CREATE TABLE countries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        iso_code VARCHAR(8) NOT NULL UNIQUE
      );
      CREATE TABLE schools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country_id UUID NOT NULL REFERENCES countries(id),
        school_code VARCHAR(32) NOT NULL UNIQUE,
        login_code VARCHAR(32),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id),
        user_code VARCHAR(64) NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_code VARCHAR(64) NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE school_settings (
        school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
        period_mode TEXT NOT NULL DEFAULT 'trimestre',
        student_card_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        student_card_qr_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        student_card_nfc_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        student_card_attendance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        student_card_finance_check_enabled BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID,
        user_id UUID,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        old_value JSONB,
        new_value JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(STUDENT_ACCESS_CARDS_SCHEMA_SQL);

    const country = (await pool.query(`INSERT INTO countries (name, iso_code) VALUES ('RDC', 'CD') RETURNING id`)).rows[0];
    const schoolA = (
      await pool.query(
        `INSERT INTO schools (country_id, school_code, login_code, name)
         VALUES ($1, 'CD-2026-0001', 'CD-LAC-26-001', 'École A') RETURNING id, login_code`,
        [country.id],
      )
    ).rows[0];
    const schoolB = (
      await pool.query(
        `INSERT INTO schools (country_id, school_code, login_code, name)
         VALUES ($1, 'BI-2026-0001', 'BI-BUJ-26-001', 'École B') RETURNING id, login_code`,
        [country.id],
      )
    ).rows[0];
    const userA = (
      await pool.query(
        `INSERT INTO users (school_id, user_code, first_name, last_name)
         VALUES ($1, 'USR-A', 'Admin', 'A') RETURNING id`,
        [schoolA.id],
      )
    ).rows[0];
    const studentA = (
      await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name)
         VALUES ($1, 'STU-A', 'Amina', 'K') RETURNING id`,
        [schoolA.id],
      )
    ).rows[0];
    const studentA2 = (
      await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name)
         VALUES ($1, 'STU-A2', 'Binta', 'K') RETURNING id`,
        [schoolA.id],
      )
    ).rows[0];
    const studentB = (
      await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name)
         VALUES ($1, 'STU-B', 'Chika', 'M') RETURNING id`,
        [schoolB.id],
      )
    ).rows[0];

    const repo = createRepo(pool, audits);
    const principalA = { sub: userA.id, role: "Admin School", schoolCode: schoolA.login_code };
    const scopeA = { mode: "school", schoolId: schoolA.id, loginCode: schoolA.login_code };
    const scopeB = { mode: "school", schoolId: schoolB.id, loginCode: schoolB.login_code };
    const auditMeta = { ipAddress: "127.0.0.1", userAgent: "test" };

    await expectHttp(
      () => issueStudentCard(repo, { studentId: studentA.id, medium: "nfc_qr" }, principalA, auditMeta, scopeA),
      404,
      STUDENT_CARD_ERROR.DISABLED,
    );
    await expectHttp(
      () => listStudentCards(repo, studentA.id, scopeA),
      404,
      STUDENT_CARD_ERROR.DISABLED,
    );
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM student_access_cards`)).rows[0].n, 0);

    await pool.query(`INSERT INTO school_settings (school_id, student_card_enabled) VALUES ($1, TRUE)`, [schoolA.id]);
    await pool.query(`INSERT INTO school_settings (school_id, student_card_enabled) VALUES ($1, TRUE)`, [schoolB.id]);

    const issued = await issueStudentCard(
      repo,
      { studentId: studentA.id, medium: "nfc_qr" },
      principalA,
      auditMeta,
      scopeA,
    );
    assert.equal(issued.status, "active");
    assert.equal(issued.medium, "nfc_qr");
    assert.ok(issued.cardToken.includes("."));
    const [publicId, secret] = issued.cardToken.split(".");
    assert.equal(publicId, issued.publicId);
    assert.ok(Buffer.from(secret, "base64url").length >= 16);
    assert.equal(issued.token_hash, undefined);

    const dbRow = (
      await pool.query(`SELECT * FROM student_access_cards WHERE id = $1`, [issued.id])
    ).rows[0];
    assert.equal(dbRow.token_hash, sha256Hex(secret));
    assert.equal(dbRow.status, "active");
    const dbDump = JSON.stringify(dbRow);
    assert.equal(dbDump.includes(secret), false);
    assert.equal(dbDump.includes(issued.cardToken), false);

    await expectHttp(
      () => issueStudentCard(repo, { studentId: studentA.id, medium: "qr" }, principalA, auditMeta, scopeA),
      409,
      STUDENT_CARD_ERROR.ACTIVE_ALREADY_EXISTS,
    );

    const listed = await listStudentCards(repo, studentA.id, scopeA);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, issued.id);
    assert.equal(listed[0].cardToken, undefined);
    assert.equal(listed[0].token_hash, undefined);
    assert.equal(JSON.stringify(listed).includes(secret), false);

    await expectHttp(
      () => listStudentCards(repo, studentA.id, scopeB),
      404,
      STUDENT_CARD_ERROR.STUDENT_NOT_FOUND,
    );
    await expectHttp(
      () => markStudentCardLost(repo, issued.id, principalA, auditMeta, scopeB, "lost"),
      404,
      STUDENT_CARD_ERROR.NOT_FOUND,
    );
    await expectHttp(
      () => issueStudentCard(repo, { studentId: studentB.id, medium: "qr" }, principalA, auditMeta, scopeA),
      404,
      STUDENT_CARD_ERROR.STUDENT_NOT_FOUND,
    );

    const lost = await markStudentCardLost(repo, issued.id, principalA, auditMeta, scopeA, "lost");
    assert.equal(lost.status, "lost");
    assert.ok(lost.revokedAt);
    const lostAgain = await markStudentCardLost(repo, issued.id, principalA, auditMeta, scopeA, "lost-again");
    assert.equal(lostAgain.status, "lost");
    assert.equal(String(lostAgain.revokedAt), String(lost.revokedAt));
    assert.equal(lostAgain.revokeReason, "lost");

    await expectHttp(
      () => revokeStudentCard(repo, issued.id, principalA, auditMeta, scopeA, "revoked"),
      409,
      STUDENT_CARD_ERROR.INVALID_STATE,
    );

    const replacedFromLost = await replaceStudentCard(repo, issued.id, principalA, auditMeta, scopeA);
    assert.equal(replacedFromLost.previous.status, "replaced");
    assert.equal(replacedFromLost.previous.replacedByCardId, replacedFromLost.card.id);
    assert.equal(replacedFromLost.card.status, "active");
    assert.notEqual(replacedFromLost.card.publicId, issued.publicId);
    assert.notEqual(replacedFromLost.card.cardToken, issued.cardToken);
    const newSecret = replacedFromLost.card.cardToken.split(".")[1];
    const newRow = (await pool.query(`SELECT * FROM student_access_cards WHERE id = $1`, [replacedFromLost.card.id])).rows[0];
    assert.equal(newRow.token_hash, sha256Hex(newSecret));
    assert.notEqual(newRow.token_hash, dbRow.token_hash);
    const actives = await pool.query(
      `SELECT count(*)::int AS n FROM student_access_cards WHERE school_id=$1 AND student_id=$2 AND status='active'`,
      [schoolA.id, studentA.id],
    );
    assert.equal(actives.rows[0].n, 1);

    await expectHttp(
      () => replaceStudentCard(repo, issued.id, principalA, auditMeta, scopeA),
      409,
      STUDENT_CARD_ERROR.INVALID_STATE,
    );

    const revokedCard = await issueStudentCard(
      repo,
      { studentId: studentA2.id, medium: "nfc" },
      principalA,
      auditMeta,
      scopeA,
    );
    const revoked = await revokeStudentCard(repo, revokedCard.id, principalA, auditMeta, scopeA, "admin");
    assert.equal(revoked.status, "revoked");
    const revokedAgain = await revokeStudentCard(repo, revokedCard.id, principalA, auditMeta, scopeA, "admin-2");
    assert.equal(revokedAgain.status, "revoked");
    assert.equal(String(revokedAgain.revokedAt), String(revoked.revokedAt));
    await expectHttp(
      () => replaceStudentCard(repo, revokedCard.id, principalA, auditMeta, scopeA),
      409,
      STUDENT_CARD_ERROR.INVALID_STATE,
    );

    const beforeRollback = (await pool.query(`SELECT count(*)::int AS n FROM student_access_cards`)).rows[0].n;
    const rollbackTarget = await issueStudentCard(
      repo,
      { studentId: studentB.id, medium: "qr" },
      { sub: userA.id, role: "Admin School" },
      auditMeta,
      scopeB,
    );
    try {
      await replaceStudentCard(repo, rollbackTarget.id, principalA, auditMeta, scopeB, { failAfterInsert: true });
      assert.fail("replace injecté aurait dû échouer");
    } catch (error) {
      assert.equal(error.code, "STUDENT_CARD_REPLACE_INJECTED_FAILURE");
    }
    const stillActive = (
      await pool.query(`SELECT status FROM student_access_cards WHERE id=$1`, [rollbackTarget.id])
    ).rows[0];
    assert.equal(stillActive.status, "active");
    const afterRollback = (await pool.query(`SELECT count(*)::int AS n FROM student_access_cards`)).rows[0].n;
    assert.equal(afterRollback, beforeRollback + 1);

    const concStudent = (
      await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name)
         VALUES ($1, 'STU-CONC', 'Concurrent', 'C') RETURNING id`,
        [schoolA.id],
      )
    ).rows[0];
    const concResults = await Promise.allSettled([
      issueStudentCard(repo, { studentId: concStudent.id, medium: "qr" }, principalA, auditMeta, scopeA),
      issueStudentCard(repo, { studentId: concStudent.id, medium: "nfc" }, principalA, auditMeta, scopeA),
    ]);
    const fulfilled = concResults.filter((row) => row.status === "fulfilled");
    const rejected = concResults.filter((row) => row.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactement une émission concurrente réussit");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, STUDENT_CARD_ERROR.ACTIVE_ALREADY_EXISTS);
    const concActives = await pool.query(
      `SELECT count(*)::int AS n FROM student_access_cards WHERE school_id=$1 AND student_id=$2 AND status='active'`,
      [schoolA.id, concStudent.id],
    );
    assert.equal(concActives.rows[0].n, 1, "D8: une seule active après concurrence");

    await pool.query(`UPDATE school_settings SET student_card_enabled = FALSE WHERE school_id = $1`, [schoolA.id]);
    await expectHttp(
      () => markStudentCardLost(repo, fulfilled[0].value.id, principalA, auditMeta, scopeA, "lost"),
      404,
      STUDENT_CARD_ERROR.DISABLED,
    );
    await expectHttp(
      () => revokeStudentCard(repo, fulfilled[0].value.id, principalA, auditMeta, scopeA, "revoked"),
      404,
      STUDENT_CARD_ERROR.DISABLED,
    );
    await expectHttp(
      () => replaceStudentCard(repo, fulfilled[0].value.id, principalA, auditMeta, scopeA),
      404,
      STUDENT_CARD_ERROR.DISABLED,
    );

    const auditDump = JSON.stringify(audits);
    assert.match(auditDump, /student_card_issued/);
    assert.match(auditDump, /student_card_lost/);
    assert.match(auditDump, /student_card_revoked/);
    assert.match(auditDump, /student_card_replaced/);
    assert.equal(auditDump.includes(secret), false);
    assert.equal(auditDump.includes("cardToken"), false);
    assert.equal(auditDump.includes("token_hash"), false);
    const pgAudit = await pool.query(`SELECT action, new_value::text AS payload FROM audit_logs`);
    for (const row of pgAudit.rows) {
      assert.equal(String(row.payload ?? "").includes(secret), false, row.action);
      assert.doesNotMatch(String(row.payload ?? ""), /cardToken|token_hash|"secret"/);
    }

    const generated = generateCardSecrets();
    assert.ok(generated.secretBits >= 128);
    console.log("studentAccessCards.lifecycle.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
