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

  const rbac = read("backend/services/rbacService.js");
  const guard = read("backend/lib/platformPersonalDataGuard.js");
  const management = read("backend/lib/studentAccessCardsManagement.js");
  const store = read("backend/db/studentAccessCardsPgStore.js");
  const catalog = read("backend/lib/functionalModulesCatalog.js");
  const presences = read("backend/lib/presencesAttendanceAuthz.js");

  assert.match(STUDENT_ACCESS_CARDS_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS student_access_cards/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS student_access_cards/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS student_access_cards/);
  assert.match(repo, /ensureStudentAccessCardsCanonicalSchema/);
  assert.match(repo, /getStudentAccessCardsStore/);
  assert.match(flags, /student_card_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.doesNotMatch(settings, /POST \/api\/student-cards\/scan/);
  assert.match(server, /app\.post\("\/api\/student-cards"/);
  assert.match(server, /app\.get\("\/api\/students\/:id\/cards"/);
  assert.match(server, /app\.post\("\/api\/student-cards\/:id\/lost"/);
  assert.match(server, /app\.post\("\/api\/student-cards\/:id\/revoke"/);
  assert.match(server, /app\.post\("\/api\/student-cards\/:id\/replace"/);
  assert.match(server, /withIdempotency/);
  assert.doesNotMatch(server, /\/api\/student-cards\/scan/);
  assert.doesNotMatch(server, /\/api\/student-access-cards/);
  assert.match(rbac, /"GET \/api\/students\/:id\/cards": \["Élèves:READ", "Voir élèves"\]/);
  assert.match(rbac, /"POST \/api\/student-cards": \["Élèves:UPDATE", "Gérer élèves"\]/);
  assert.doesNotMatch(rbac, /Cartes:READ|Cartes:CREATE|QR:|NFC:/);
  assert.match(guard, /"POST \/api\/student-cards"/);
  assert.match(guard, /"GET \/api\/students\/:id\/cards"/);
  assert.match(management, /crypto\.randomBytes/);
  assert.match(management, /sha256/);
  assert.match(management, /student_card_issued/);
  assert.match(store, /FOR UPDATE/);
  assert.match(store, /BEGIN|withTransaction/);
  assert.doesNotMatch(catalog, /Carte Élève|moduleKey: "cards"/);
  assert.doesNotMatch(presences, /student_access_cards|cardToken/);
  assert.doesNotMatch(schema, /\bnfc_uid\b|\bqr_payload\b|\braw_token\b/);
  assert.doesNotMatch(migration, /CREATE TABLE student_debts|CREATE TABLE student_invoices/);
  console.log("verify-student-access-cards (statique): SUCCESS");
}

main();
