"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL } = require("../db/studentAccessCardsSchema");
const { createStudentAccessCardsPgStore } = require("../db/studentAccessCardsPgStore");
const {
  STUDENT_CARD_ERROR,
  issueStudentCard,
  replaceStudentCard,
  scanStudentCard,
} = require("./studentAccessCardsManagement");

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const IT_DB = String(process.env.SOMAFRIK_STUDENT_CARDS_RESOLVE_IT_DATABASE ?? "somafrik_student_cards_resolve_it")
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

async function expectHttp(fn, status, code) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.statusCode, status, `${code}: ${error.statusCode} ${error.message}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`${code}: aurait dû être rejeté`);
}

function createRepo(pool) {
  const audits = { writes: 0 };
  const repo = {
    engine: "postgresql",
    query: (sql, params) => pool.query(sql, params),
    one: async (sql, params) => (await pool.query(sql, params)).rows[0] ?? null,
    all: async (sql, params) => (await pool.query(sql, params)).rows,
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx = {
          query: (sql, params) => client.query(sql, params),
          one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null,
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* keep */
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
    async recordAudit() {
      audits.writes += 1;
    },
    auditWrites: () => audits.writes,
  };
  return repo;
}

async function main() {
  if (!DATABASE_URL) {
    console.log("studentAccessCards.resolve.pg.test.js SKIP (DATABASE_URL absent)");
    return;
  }
  const isolatedUrl = await ensureDatabase(DATABASE_URL, IT_DB);
  const pool = new Pool({ connectionString: isolatedUrl });
  try {
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await pool.query(`
      CREATE TABLE countries (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, iso_code VARCHAR(8) NOT NULL UNIQUE);
      CREATE TABLE schools (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        country_id UUID NOT NULL REFERENCES countries(id),
        school_code VARCHAR(32) NOT NULL UNIQUE,
        login_code VARCHAR(32),
        name TEXT NOT NULL
      );
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id),
        user_code VARCHAR(64) NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL
      );
      CREATE TABLE students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_code VARCHAR(64) NOT NULL UNIQUE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        photo_url TEXT,
        parent_phone TEXT,
        parent_email TEXT,
        birth_date DATE,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE academic_years (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        name TEXT NOT NULL,
        is_current BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'open'
      );
      CREATE TABLE classes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        academic_year_id UUID NOT NULL REFERENCES academic_years(id),
        class_code VARCHAR(64) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE enrollments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id),
        student_id UUID NOT NULL REFERENCES students(id),
        class_id UUID REFERENCES classes(id),
        academic_year_id UUID NOT NULL REFERENCES academic_years(id),
        status TEXT NOT NULL DEFAULT 'ENROLLED',
        UNIQUE (student_id, academic_year_id)
      );
      CREATE TABLE school_settings (
        school_id UUID PRIMARY KEY REFERENCES schools(id),
        student_card_enabled BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE attendance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL,
        student_id UUID NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE payments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount NUMERIC);
      CREATE TABLE student_fee_obligations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), balance NUMERIC);
      CREATE TABLE payment_allocations (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
    `);
    await pool.query(STUDENT_ACCESS_CARDS_SCHEMA_SQL);

    const country = (await pool.query(`INSERT INTO countries (name, iso_code) VALUES ('RDC','CD') RETURNING id`)).rows[0];
    const schoolA = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name) VALUES ($1,'CD-2026-0001','CD-LAC-26-001','A') RETURNING id`,
      [country.id],
    )).rows[0];
    const schoolB = (await pool.query(
      `INSERT INTO schools (country_id, school_code, login_code, name) VALUES ($1,'BI-2026-0001','BI-BUJ-26-001','B') RETURNING id`,
      [country.id],
    )).rows[0];
    const userA = (await pool.query(
      `INSERT INTO users (school_id, user_code, first_name, last_name) VALUES ($1,'USR-A','Ada','A') RETURNING id`,
      [schoolA.id],
    )).rows[0];
    await pool.query(
      `INSERT INTO school_settings (school_id, student_card_enabled) VALUES ($1, TRUE), ($2, TRUE)`,
      [schoolA.id, schoolB.id],
    );
    const yearA = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current) VALUES ($1,'2026-2027', TRUE) RETURNING id`,
      [schoolA.id],
    )).rows[0];
    const yearOld = (await pool.query(
      `INSERT INTO academic_years (school_id, name, is_current) VALUES ($1,'2025-2026', FALSE) RETURNING id`,
      [schoolA.id],
    )).rows[0];
    const classA = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,'CL-A','6e A') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classB = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,'CL-B','5e B') RETURNING id`,
      [schoolA.id, yearA.id],
    )).rows[0];
    const classOld = (await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, class_code, name) VALUES ($1,$2,'CL-OLD','4e') RETURNING id`,
      [schoolA.id, yearOld.id],
    )).rows[0];

    async function addStudent(code, schoolId) {
      return (await pool.query(
        `INSERT INTO students (school_id, student_code, first_name, last_name, photo_url, parent_phone)
         VALUES ($1,$2,'Amina','K','https://photo.example/a','+243000') RETURNING id`,
        [schoolId, code],
      )).rows[0];
    }
    const student = await addStudent("STU-A", schoolA.id);
    const studentLost = await addStudent("STU-LOST", schoolA.id);
    const studentRevoked = await addStudent("STU-REV", schoolA.id);
    const studentBare = await addStudent("STU-BARE", schoolA.id);
    const studentApproved = await addStudent("STU-APP", schoolA.id);
    const studentTransferred = await addStudent("STU-TR", schoolA.id);
    const studentClosed = await addStudent("STU-CL", schoolA.id);
    const studentOld = await addStudent("STU-OLD", schoolA.id);
    const studentMismatch = await addStudent("STU-MIS", schoolA.id);
    const studentB = await addStudent("STU-B", schoolB.id);

    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'ENROLLED')`,
      [schoolA.id, student.id, classA.id, yearA.id],
    );

    const repo = createRepo(pool);
    async function scan(payload, scope) {
      const beforeAudits = repo.auditWrites();
      try {
        return await scanStudentCard(repo, payload, scope);
      } finally {
        assert.equal(repo.auditWrites(), beforeAudits, "scan ne doit pas écrire d'audit");
      }
    }
    const principal = { sub: userA.id, role: "Enseignant" };
    const scopeA = { mode: "school", schoolId: schoolA.id, loginCode: "CD-LAC-26-001" };
    const scopeB = { mode: "school", schoolId: schoolB.id, loginCode: "BI-BUJ-26-001" };
    const audit = {};

    const issued = await issueStudentCard(repo, { studentId: student.id, medium: "nfc_qr" }, principal, audit, scopeA);
    const before = await pool.query(
      `SELECT token_hash, status, last_scan_at, updated_at FROM student_access_cards WHERE id = $1`,
      [issued.id],
    );
    const attendanceBefore = (await pool.query(`SELECT count(*)::int AS n FROM attendance`)).rows[0].n;
    const paymentsBefore = (await pool.query(`SELECT count(*)::int AS n FROM payments`)).rows[0].n;
    const feesBefore = (await pool.query(`SELECT count(*)::int AS n FROM student_fee_obligations`)).rows[0].n;
    const allocBefore = (await pool.query(`SELECT count(*)::int AS n FROM payment_allocations`)).rows[0].n;

    const resolved = await scan({ cardToken: issued.cardToken }, scopeA);
    assert.equal(resolved.card.id, issued.id);
    assert.equal(resolved.card.status, "active");
    assert.equal(resolved.card.publicId, issued.publicId);
    assert.equal(resolved.student.id, student.id);
    assert.equal(resolved.student.studentCode, "STU-A");
    assert.equal(resolved.class.classCode, "CL-A");
    assert.equal(resolved.class.className, "6e A");
    assert.equal(resolved.card.token_hash, undefined);
    assert.equal(resolved.card.cardToken, undefined);
    assert.equal(JSON.stringify(resolved).includes(issued.cardToken.split(".")[1]), false);
    assert.equal(JSON.stringify(resolved).includes("parent_phone"), false);
    assert.equal(JSON.stringify(resolved).includes("+243000"), false);
    const afterFirst = await pool.query(
      `SELECT token_hash, status, last_scan_at, updated_at FROM student_access_cards WHERE id = $1`,
      [issued.id],
    );
    assert.equal(afterFirst.rows[0].last_scan_at, null);
    assert.equal(afterFirst.rows[0].status, before.rows[0].status);
    assert.equal(afterFirst.rows[0].token_hash, before.rows[0].token_hash);
    assert.equal(String(afterFirst.rows[0].updated_at), String(before.rows[0].updated_at));

    const unknown = await expectHttp(
      () => scan( { cardToken: `${issued.publicId}xxxx.${issued.cardToken.split(".")[1]}` }, scopeA),
      404,
      STUDENT_CARD_ERROR.NOT_FOUND,
    );
    const badSecret = await expectHttp(
      () => scan( { cardToken: `${issued.publicId}.wrongSecretValue12` }, scopeA),
      404,
      STUDENT_CARD_ERROR.NOT_FOUND,
    );
    assert.equal(unknown.statusCode, badSecret.statusCode);
    assert.equal(unknown.code, badSecret.code);
    assert.equal(unknown.message, badSecret.message);

    const other = await issueStudentCard(repo, { studentId: studentB.id, medium: "qr" }, principal, audit, scopeB);
    const cross = await expectHttp(
      () => scan( { cardToken: other.cardToken }, scopeA),
      404,
      STUDENT_CARD_ERROR.NOT_FOUND,
    );
    assert.equal(cross.message, badSecret.message);
    assert.equal(JSON.stringify(cross).includes(studentB.id), false);

    async function issueFor(studentId, medium = "qr") {
      return issueStudentCard(repo, { studentId, medium }, principal, audit, scopeA);
    }
    const lostCard = await issueFor(studentLost.id);
    await pool.query(
      `UPDATE student_access_cards SET status='lost', revoked_at=NOW(), revoke_reason='lost' WHERE id=$1`,
      [lostCard.id],
    );
    await expectHttp(
      () => scan({ cardToken: `${lostCard.publicId}.wrongSecretValue12` }, scopeA),
      404,
      STUDENT_CARD_ERROR.NOT_FOUND,
    );
    await expectHttp(
      () => scan( { cardToken: lostCard.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.INVALID_STATE,
    );
    const revokedCard = await issueFor(studentRevoked.id, "nfc");
    await pool.query(
      `UPDATE student_access_cards SET status='revoked', revoked_at=NOW(), revoke_reason='revoked' WHERE id=$1`,
      [revokedCard.id],
    );
    await expectHttp(
      () => scan( { cardToken: revokedCard.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.INVALID_STATE,
    );

    const replaced = await replaceStudentCard(repo, issued.id, principal, audit, scopeA);
    await expectHttp(
      () => scan( { cardToken: issued.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.INVALID_STATE,
    );
    const fresh = await scan( { cardToken: replaced.card.cardToken }, scopeA);
    assert.equal(fresh.card.id, replaced.card.id);
    assert.equal(fresh.class.classCode, "CL-A");

    await pool.query(`UPDATE enrollments SET class_id = $1 WHERE student_id = $2`, [classB.id, student.id]);
    const moved = await scan( { cardToken: replaced.card.cardToken }, scopeA);
    assert.equal(moved.class.id, classB.id);
    assert.equal(moved.class.classCode, "CL-B");

    const bare = await issueFor(studentBare.id);
    await expectHttp(
      () => scan( { cardToken: bare.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED,
    );
    const approved = await issueFor(studentApproved.id);
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, academic_year_id, status) VALUES ($1,$2,$3,'APPROVED')`,
      [schoolA.id, studentApproved.id, yearA.id],
    );
    await expectHttp(
      () => scan( { cardToken: approved.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED,
    );
    const transferred = await issueFor(studentTransferred.id);
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'TRANSFERRED')`,
      [schoolA.id, studentTransferred.id, classA.id, yearA.id],
    );
    await expectHttp(
      () => scan( { cardToken: transferred.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED,
    );
    const closed = await issueFor(studentClosed.id);
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'CLOSED')`,
      [schoolA.id, studentClosed.id, classA.id, yearA.id],
    );
    await expectHttp(
      () => scan( { cardToken: closed.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED,
    );
    const oldYear = await issueFor(studentOld.id);
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'ENROLLED')`,
      [schoolA.id, studentOld.id, classOld.id, yearOld.id],
    );
    await expectHttp(
      () => scan( { cardToken: oldYear.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED,
    );
    const mismatch = await issueFor(studentMismatch.id);
    await pool.query(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, status)
       VALUES ($1,$2,$3,$4,'ENROLLED')`,
      [schoolA.id, studentMismatch.id, classOld.id, yearA.id],
    );
    await expectHttp(
      () => scan( { cardToken: mismatch.cardToken }, scopeA),
      409,
      STUDENT_CARD_ERROR.ENROLLMENT_UNRESOLVED,
    );

    await pool.query(`UPDATE school_settings SET student_card_enabled = FALSE WHERE school_id = $1`, [schoolA.id]);
    await expectHttp(
      () => scan( { cardToken: replaced.card.cardToken }, scopeA),
      404,
      STUDENT_CARD_ERROR.DISABLED,
    );

    const after = await pool.query(
      `SELECT token_hash, status, last_scan_at FROM student_access_cards WHERE id = $1`,
      [replaced.card.id],
    );
    assert.equal(after.rows[0].last_scan_at, null);
    assert.equal(after.rows[0].token_hash, (await pool.query(`SELECT token_hash FROM student_access_cards WHERE id=$1`, [replaced.card.id])).rows[0].token_hash);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM attendance`)).rows[0].n, attendanceBefore);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM payments`)).rows[0].n, paymentsBefore);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM student_fee_obligations`)).rows[0].n, feesBefore);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM payment_allocations`)).rows[0].n, allocBefore);
    assert.equal(JSON.stringify(after.rows[0]).includes(replaced.card.cardToken.split(".")[1]), false);
    void before;
    console.log("studentAccessCards.resolve.pg.test.js OK");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
