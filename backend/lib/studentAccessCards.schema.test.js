"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  STUDENT_ACCESS_CARDS_SCHEMA_SQL,
  STUDENT_ACCESS_CARDS_TABLE_SQL,
} = require("../db/studentAccessCardsSchema");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripSqlNoise(sql) {
  return String(sql)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

test("CARTE-PR1 — DDL public_id / token_hash / medium / status / D8 / tenant", () => {
  const sql = STUDENT_ACCESS_CARDS_TABLE_SQL;
  assert.match(sql, /CREATE TABLE IF NOT EXISTS student_access_cards/);
  assert.match(sql, /public_id TEXT NOT NULL/);
  assert.match(sql, /token_hash TEXT NOT NULL/);
  assert.match(sql, /CONSTRAINT student_access_cards_public_id_key UNIQUE \(public_id\)/);
  assert.match(sql, /CONSTRAINT student_access_cards_token_hash_key UNIQUE \(token_hash\)/);
  assert.match(sql, /CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /CHECK \(medium IN \('nfc', 'qr', 'nfc_qr'\)\)/);
  assert.match(sql, /CHECK \(status IN \('issued', 'active', 'lost', 'revoked', 'replaced'\)\)/);
  assert.match(sql, /FOREIGN KEY \(school_id, student_id\)/);
  assert.match(sql, /REFERENCES students \(school_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(school_id, student_id, replaced_by_card_id\)/);
  assert.match(STUDENT_ACCESS_CARDS_SCHEMA_SQL, /WHERE status = 'active'/);
  assert.match(STUDENT_ACCESS_CARDS_SCHEMA_SQL, /students_school_id_id_uidx/);
  assert.doesNotMatch(sql, /\btoken\b/);
  assert.doesNotMatch(sql, /\bsecret\b/);
  assert.doesNotMatch(sql, /raw_token|qr_payload|nfc_uid/);
  assert.doesNotMatch(sql, /first_name|parent_phone|parent_email|birth_date|class_id|jwt/i);
});

test("CARTE-PR1 — schema.sql, migration et module restent alignés", () => {
  const schema = read("backend/db/schema.sql");
  const migration = read("backend/db/migrations/20261006_student_access_cards.sql");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS student_access_cards/);
  assert.match(schema, /student_access_cards_one_active_per_student/);
  assert.match(schema, /students_school_id_id_uidx/);
  for (const fragment of [
    "student_access_cards_token_hash_sha256_check",
    "student_access_cards_student_tenant_fk",
    "student_access_cards_replaced_by_same_student_fk",
    "student_access_cards_lifecycle_check",
  ]) {
    assert.match(schema, new RegExp(fragment));
    assert.match(migration, new RegExp(fragment));
    assert.match(STUDENT_ACCESS_CARDS_SCHEMA_SQL, new RegExp(fragment));
  }
  const tableFromSchema = schema.slice(
    schema.indexOf("CREATE TABLE IF NOT EXISTS student_access_cards"),
    schema.indexOf("CREATE TABLE IF NOT EXISTS enrollments"),
  );
  assert.ok(stripSqlNoise(tableFromSchema).includes("CREATE TABLE IF NOT EXISTS student_access_cards"));
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS students_school_id_id_uidx/);
});

test("CARTE-PR1 — boot PostgreSQL applique le schéma dédié", () => {
  const repo = read("backend/db/postgresRepository.js");
  assert.match(repo, /ensureStudentAccessCardsCanonicalSchema/);
  const schemaIdx = repo.indexOf("await this.query(schema)");
  const cardsIdx = repo.indexOf("ensureStudentAccessCardsCanonicalSchema");
  assert.ok(schemaIdx > 0 && cardsIdx > schemaIdx);
});

test("CARTE-PR3 — scan resolve uniquement, aucune écriture présence/finance ni module Cartes", () => {
  const server = read("backend/server.js");
  const demo = read("backend/demoGateway.js");
  const presences = read("backend/lib/presencesAttendanceAuthz.js");
  const catalog = read("backend/lib/functionalModulesCatalog.js");
  const rbac = read("backend/services/rbacService.js");
  assert.match(server, /app\.post\("\/api\/student-cards"/);
  assert.match(server, /app\.get\("\/api\/students\/:id\/cards"/);
  assert.match(server, /app\.post\("\/api\/student-cards\/:id\/lost"/);
  assert.match(server, /app\.post\("\/api\/student-cards\/:id\/revoke"/);
  assert.match(server, /app\.post\("\/api\/student-cards\/:id\/replace"/);
  const issueRoute = server.slice(
    server.indexOf('app.post("/api/student-cards"'),
    server.indexOf('app.post("/api/student-cards/:id/lost"'),
  );
  assert.match(issueRoute, /issueStudentCard/);
  assert.match(issueRoute, /Cache-Control", "no-store"/);
  assert.doesNotMatch(issueRoute, /withIdempotency/);
  const replaceRoute = server.slice(
    server.indexOf('app.post("/api/student-cards/:id/replace"'),
    server.indexOf("async function authorizeEnrollmentStudentOr404"),
  );
  assert.match(replaceRoute, /replaceStudentCard/);
  assert.match(replaceRoute, /Cache-Control", "no-store"/);
  assert.doesNotMatch(replaceRoute, /withIdempotency/);
  assert.match(server, /app\.post\("\/api\/student-cards\/scan"/);
  const scanRoute = server.slice(
    server.indexOf('app.post("/api/student-cards/scan"'),
    server.indexOf('app.post("/api/student-cards/:id/replace"'),
  );
  assert.match(scanRoute, /Cache-Control", "no-store"/);
  assert.match(scanRoute, /withIdempotency/);
  assert.match(scanRoute, /routeKey: "POST \/api\/student-cards\/scan"/);
  assert.doesNotMatch(scanRoute, /upsertAttendance|upsertSchoolAttendanceBatch|listFinanceStudentFees|last_scan_at/);
  assert.doesNotMatch(server, /app\.get\("\/api\/student-cards\/scan"/);
  assert.doesNotMatch(server, /\/verify\/student-card|\/api\/public\/student-card/);
  assert.doesNotMatch(demo, /\/api\/student-cards\/scan|student_access_cards/);
  assert.doesNotMatch(presences, /student_access_cards|cardToken/);
  assert.doesNotMatch(catalog, /Carte Élève|student_access_cards|moduleKey: "cards"/);
  assert.match(rbac, /"GET \/api\/students\/:id\/cards": \["Élèves:READ", "Voir élèves"\]/);
  assert.match(rbac, /"POST \/api\/student-cards": \["Élèves:UPDATE", "Gérer élèves"\]/);
  assert.match(rbac, /"POST \/api\/student-cards\/scan": \["Présences:CREATE", "Présences:UPDATE"\]/);
  assert.doesNotMatch(rbac, /Cartes:READ|Cartes:UPDATE|Cartes:SCAN|QR:|NFC:/);
  assert.doesNotMatch(read("web/src/lib/schoolSettingsApi.ts"), /student_access_cards|cardToken/);
  assert.doesNotMatch(read("Mobile/src/services/schoolSettingsApi.ts"), /student_access_cards|cardToken/);
});
