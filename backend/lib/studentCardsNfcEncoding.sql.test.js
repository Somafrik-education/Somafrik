"use strict";
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL } = require("../db/studentAccessCardsSchema");
const { createStudentAccessCardsPgStore } = require("../db/studentAccessCardsPgStore");
const { generateCardSecrets } = require("./studentAccessCardsManagement");

// Requires a disposable test schema/database; never uses the application's DATABASE_URL.
async function runNfcSqlChecks(db) {
  await db.query(`CREATE TABLE schools (id UUID PRIMARY KEY); CREATE TABLE users (id UUID PRIMARY KEY);
    CREATE TABLE students (id UUID PRIMARY KEY, school_id UUID NOT NULL REFERENCES schools(id), student_code TEXT, status TEXT);`);
  const schoolA = "11111111-1111-4111-8111-111111111111";
  const schoolB = "22222222-2222-4222-8222-222222222222";
  const studentA = "33333333-3333-4333-8333-333333333333";
  const studentB = "44444444-4444-4444-8444-444444444444";
  await db.query("INSERT INTO schools VALUES ($1),($2)", [schoolA, schoolB]);
  await db.query("INSERT INTO students VALUES ($1,$2,'A','active'),($3,$4,'B','active')", [studentA, schoolA, studentB, schoolB]);
  await db.query(STUDENT_ACCESS_CARDS_SCHEMA_SQL);
  await db.query(STUDENT_ACCESS_CARDS_SCHEMA_SQL); // migrations idempotent
  const repo = { query: db.query.bind(db), one: async (sql, params) => (await db.query(sql, params)).rows[0] || null, all: async (sql, params) => (await db.query(sql, params)).rows };
  const store = createStudentAccessCardsPgStore(repo);
  const row = (overrides = {}) => { const g = generateCardSecrets(); return { school_id: schoolA, student_id: studentA, public_id: g.publicId, token_hash: g.tokenHash, medium: "nfc", status: "issued", nfc_operation_id: randomUUID(), nfc_reservation_expires_at: new Date(Date.now()+1800000), nfc_uid: "04112233445566", nfc_tag_type: "NTAG213", nfc_encoding_state: "pending", ...overrides }; };
  for (const bad of [{ nfc_tag_type: null }, { nfc_tag_type: "NTAG215" }, { nfc_uid: "1234" }, { medium: "qr" }, { nfc_encoding_state: "locked" }]) {
    await assert.rejects(store.insert(row(bad)), (error) => error.code === "23514");
  }
  const first = await store.insert(row());
  await assert.rejects(store.insert(row({ school_id: schoolB, student_id: studentB })), (error) => error.code === "23505");
  await assert.rejects(store.insert(row({ nfc_uid: "04778899001122" })), (error) => error.code === "23505");
  assert.equal(await store.confirmNfc(schoolB, first.id, first.nfc_uid, first.nfc_tag_type, false, first.token_hash), null);
  assert.equal(await store.confirmNfc(schoolA, first.id, "04778899001122", first.nfc_tag_type, false, first.token_hash), null);
  const rotatedHash = generateCardSecrets().tokenHash;
  const rotated = await store.rotatePendingNfc(schoolA, first.id, first.nfc_uid, first.nfc_tag_type, first.token_hash, rotatedHash, randomUUID());
  assert.equal(rotated.token_hash, rotatedHash);
  assert.equal(await store.rotatePendingNfc(schoolA, first.id, first.nfc_uid, first.nfc_tag_type, first.token_hash, generateCardSecrets().tokenHash, randomUUID()), null);
  assert.equal(await store.confirmNfc(schoolA, first.id, first.nfc_uid, first.nfc_tag_type, false, first.token_hash), null);
  const encoded = await store.confirmNfc(schoolA, first.id, first.nfc_uid, first.nfc_tag_type, false, rotatedHash);
  assert.equal(await store.rotatePendingNfc(schoolA, first.id, first.nfc_uid, first.nfc_tag_type, rotatedHash, generateCardSecrets().tokenHash, randomUUID()), null);
  assert.equal(encoded.nfc_encoding_state, "encoded"); assert.ok(encoded.nfc_encoded_at); assert.equal(encoded.nfc_locked_at, null);
  const locked = await store.confirmNfc(schoolA, first.id, first.nfc_uid, first.nfc_tag_type, true, rotatedHash);
  assert.equal(locked.nfc_encoding_state, "locked"); assert.ok(locked.nfc_locked_at);
  assert.equal((await store.confirmNfc(schoolA, first.id, first.nfc_uid, first.nfc_tag_type, false, rotatedHash)).nfc_encoding_state, "locked");
  assert.equal((await store.listByStudent(schoolA, studentA))[0].nfc_uid, first.nfc_uid);
  assert.equal((await store.findByPublicIdInSchool(schoolA, first.public_id)).nfc_encoding_state, "locked");
  await store.markRevoked(schoolA, first.id, "test");
  assert.equal(await store.confirmNfc(schoolA, first.id, first.nfc_uid, first.nfc_tag_type, true, rotatedHash), null);
  await assert.rejects(store.insert(row({ school_id: schoolB, student_id: studentB })), (error) => error.code === "23505");
  const qr = await store.insert(row({ nfc_uid: null, nfc_tag_type: null, nfc_encoding_state: null, nfc_operation_id: null, nfc_reservation_expires_at: null, medium: "qr", status: "active" }));
  assert.equal(qr.nfc_uid, null);
}
const url = process.env.SOMAFRIK_NFC_TEST_DATABASE_URL;
test("NFC SQL constraints, uniqueness, tenant, monotonic lock, QR compatibility", { skip: !url }, async () => {
  const { Client } = require("pg"); const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    const schema = `nfc_test_${Date.now()}`;
    await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`);
    // Savepoints allow failed CHECK/UNIQUE statements to keep the test transaction usable.
    const db = { async query(sql, params) {
      await client.query("SAVEPOINT nfc_statement");
      try { const result = await client.query(sql, params); await client.query("RELEASE SAVEPOINT nfc_statement"); return result; }
      catch (error) { await client.query("ROLLBACK TO SAVEPOINT nfc_statement"); throw error; }
    } };
    await runNfcSqlChecks(db);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
module.exports = { runNfcSqlChecks };
