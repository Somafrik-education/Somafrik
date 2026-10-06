"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { STUDENT_ACCESS_CARDS_SCHEMA_SQL } = require("../db/studentAccessCardsSchema");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function main() {
  const schema = read("backend/db/schema.sql");
  const migration = read("backend/db/migrations/20261006_student_access_cards.sql");
  const repo = read("backend/db/postgresRepository.js");
  const server = read("backend/server.js");
  const settings = read("backend/lib/schoolSettingsManagement.js");
  const flags = read("backend/db/schoolSettingsSchema.js");

  assert.match(STUDENT_ACCESS_CARDS_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS student_access_cards/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS student_access_cards/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS student_access_cards/);
  assert.match(repo, /ensureStudentAccessCardsCanonicalSchema/);
  assert.match(flags, /student_card_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.doesNotMatch(settings, /POST \/api\/student-cards|cardToken|token_hash/);
  assert.doesNotMatch(server, /\/api\/student-cards|\/api\/student-access-cards|cardToken/);
  assert.doesNotMatch(schema, /\bnfc_uid\b|\bqr_payload\b|\braw_token\b/);
  assert.doesNotMatch(migration, /CREATE TABLE student_debts|CREATE TABLE student_invoices/);
  console.log("verify-student-access-cards (statique): SUCCESS");
}

main();
