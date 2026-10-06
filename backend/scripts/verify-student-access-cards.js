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
  const cardAttendance = read("backend/lib/studentCardAttendance.js");
  const cardFinance = read("backend/lib/studentCardFinance.js");
  const financeStore = read("backend/db/financePgStore.js");
  const unpaid = read("backend/services/unpaidService.js");

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
  assert.match(server, /routeKey: `POST \/api\/student-cards\/\$\{req\.params\.id\}\/replace`/);
  assert.match(server, /requirePermission\("POST \/api\/student-cards\/:id\/replace"\)/);
  assert.match(server, /app\.post\("\/api\/student-cards\/scan"/);
  const scanRoute = server.slice(
    server.indexOf('app.post("/api/student-cards/scan"'),
    server.indexOf('app.post("/api/student-cards/:id/replace"'),
  );
  assert.match(scanRoute, /Cache-Control", "no-store"/);
  assert.match(scanRoute, /hasAttendanceIntent/);
  assert.match(scanRoute, /write_presence/);
  assert.doesNotMatch(scanRoute.slice(0, scanRoute.indexOf("hasAttendanceIntent")), /write_presence/);
  assert.doesNotMatch(scanRoute, /upsertAttendance|upsertSchoolAttendanceBatch|listFinanceStudentFees|last_scan_at|student_card_scanned|INSERT INTO attendance/);
  assert.match(cardAttendance, /upsertSchoolAttendanceBatch/);
  assert.match(cardAttendance, /scanStudentCard\(/);
  assert.match(cardAttendance, /isStudentCardCapabilityEnabled/);
  assert.doesNotMatch(cardAttendance, /INSERT INTO attendance|listFinanceStudentFees|student_card_scanned|last_scan_at/);
  assert.match(scanRoute, /assertStudentCardScanIntents/);
  assert.match(scanRoute, /STUDENT_CARD_SCAN_INTENTS_CONFLICT|hasFinanceIntent/);
  const financeBranch = scanRoute.slice(scanRoute.indexOf("if (hasFinanceIntent(req.body))"));
  assert.match(financeBranch, /requirePermission\("GET \/api\/finance\/student-fees"\)/);
  assert.match(financeBranch, /assertStudentCardFinanceEnabled/);
  assert.match(financeBranch, /scanStudentCardFinance/);
  assert.doesNotMatch(financeBranch, /withIdempotency|write_presence|upsertSchoolAttendanceBatch|listFinanceProjection/);
  assert.match(cardFinance, /isStudentCardCapabilityEnabled/);
  assert.match(cardFinance, /studentCardFinanceCheckEnabled/);
  assert.match(cardFinance, /isDueDatePast/);
  assert.match(cardFinance, /isOverdueStudentFee/);
  assert.match(cardFinance, /listFinanceStudentFees/);
  assert.match(cardFinance, /listFinanceStudentPayments/);
  assert.doesNotMatch(cardFinance, /ensureEnrollmentObligations|applyFinanceFeeGrid|reconcileFinancePaymentAllocations|createSchoolPayment|adjustFinanceStudentFee|listFinanceProjection|withIdempotency|last_scan_at|student_card_finance_checked|student_card_scanned/);
  assert.match(financeStore, /listFinanceStudentFees: async \(principal, options = \{\}\)/);
  assert.match(financeStore, /resolveListedStudentKey/);
  assert.match(unpaid, /isDueDatePast/);
  assert.match(unpaid, /isOverdueStudentFee/);
  assert.doesNotMatch(server, /write_student_card_finance|card_finance|finance_scan|Cartes:FINANCE|Cartes:SCAN_FINANCE/);
  assert.doesNotMatch(server, /app\.get\("\/api\/student-cards\/scan"/);
  assert.doesNotMatch(server, /\/verify\/student-card|\/api\/public\/student-card/);
  assert.doesNotMatch(server, /\/api\/student-access-cards/);
  assert.match(rbac, /"GET \/api\/students\/:id\/cards": \["Élèves:READ", "Voir élèves"\]/);
  assert.match(rbac, /"POST \/api\/student-cards": \["Élèves:UPDATE", "Gérer élèves"\]/);
  assert.match(rbac, /"POST \/api\/student-cards\/scan": \["Présences:CREATE", "Présences:UPDATE"\]/);
  assert.doesNotMatch(rbac, /Cartes:READ|Cartes:CREATE|Cartes:SCAN|QR:|NFC:/);
  assert.match(guard, /"POST \/api\/student-cards\/scan"/);
  assert.match(management, /tokenHashesMatch/);
  assert.match(management, /findByPublicIdInSchool/);
  assert.match(read("backend/lib/studentCardCapability.js"), /timingSafeEqual/);
  assert.match(read("backend/lib/studentCardCapability.js"), /DUMMY_TOKEN_HASH/);
  assert.doesNotMatch(management, /student_card_scanned|last_scan_at/);
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
