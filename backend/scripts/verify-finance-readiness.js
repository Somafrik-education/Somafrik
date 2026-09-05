"use strict";

/**
 * F8 — Gate production-readiness Finance.
 * Pas une suite globale : garde ciblée + parcours PostgreSQL réel.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function run(cmd, args, label) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function sourceGuards() {
  const pgStore = read("backend/db/financePgStore.js");
  const memory = read("backend/db/financeMemoryStore.js");
  const cash = read("backend/lib/financeUnallocatedCash.js");
  const service = read("backend/lib/financeService.js");
  const catalog = read("backend/lib/financeCatalog.js");
  const unpaidBe = read("backend/services/unpaidService.js");
  const unpaidWeb = read("web/src/lib/unpaidModule.ts");
  const modal = read("web/src/components/payments/QuickPaymentModal.tsx");
  const entity = read("web/src/pages/EntityPage.tsx");
  const feesPage = read("web/src/pages/finances/FinanceFeesPage.tsx");
  const unpaidPage = read("web/src/pages/finances/FinanceUnpaidPage.tsx");
  const api = read("web/src/lib/financeApi.ts");
  const mobileControls = read("Mobile/src/components/PaymentMutationControls.tsx");
  const outbox = read("Mobile/src/lib/outbox.ts");
  const schema = read("backend/db/financeSchema.js");
  const httpTest = read("backend/lib/financeReadiness.http.pg.test.js");
  const server = read("backend/server.js");
  const lifecycle = read("backend/lib/financeObligationLifecycle.js");

  const getObligation = pgStore.slice(
    pgStore.indexOf("async getObligationByPublicId"),
    pgStore.indexOf("async updateObligation"),
  );
  assert.match(getObligation, /resolveFinanceSchoolScope/);
  assert.match(getObligation, /sqlSchoolPredicate/);
  const getPayment = pgStore.slice(
    pgStore.indexOf("async getPaymentByCode"),
    pgStore.indexOf("async resolveActorUserId"),
  );
  assert.match(getPayment, /resolveFinanceSchoolScope/);
  assert.match(getPayment, /sqlSchoolPredicate/);
  const findStudent = pgStore.slice(
    pgStore.indexOf("async findStudent"),
    pgStore.indexOf("async listActiveEnrollmentsForStudent"),
  );
  assert.match(findStudent, /resolveFinanceSchoolScope/);
  assert.match(findStudent, /sqlSchoolPredicate/);
  assert.doesNotMatch(findStudent, /schoolCode && schoolCode !== "\*"/);
  const getGrid = pgStore.slice(
    pgStore.indexOf("async getGrid"),
    pgStore.indexOf("async setGridStatus"),
  );
  assert.match(getGrid, /resolveFinanceSchoolScope/);
  assert.match(getGrid, /sqlSchoolPredicate/);
  assert.match(memory, /fixtureRecordInScope\(mapped, scope\)/);
  assert.match(memory, /fixtureRecordInScope\(student, scope\)/);
  assert.match(memory, /function fixtureRecordInScope/);
  assert.match(memory, /withFixtureLoginCode\(record\)/);

  const scopeLib = read("backend/lib/financeSchoolScope.js");
  const schoolCodeFn = scopeLib.slice(
    scopeLib.indexOf("function schoolCodeInScope"),
    scopeLib.indexOf("function schoolRecordInFinanceScope"),
  );
  assert.doesNotMatch(schoolCodeFn, /slice\(\s*0\s*,\s*2\s*\)/);
  assert.match(scopeLib, /function schoolRecordInFinanceScope/);
  assert.match(scopeLib, /iso_code/);
  assert.match(scopeLib, /attachFinanceMembershipScope/);
  assert.match(scopeLib, /principal\.sub → users\.id → users\.school_id/);
  const resolveFn = scopeLib.slice(
    scopeLib.indexOf("function resolveFinanceSchoolScope"),
    scopeLib.indexOf("function sqlSchoolPredicate"),
  );
  assert.match(resolveFn, /financeLoginCode/);
  assert.doesNotMatch(resolveFn, /principal\.schoolCode/);
  const predFn = scopeLib.slice(scopeLib.indexOf("function sqlSchoolPredicate"), scopeLib.indexOf("function countryIsoFromRecord"));
  assert.match(predFn, /login_code/);
  assert.doesNotMatch(predFn, /school_code/);
  assert.doesNotMatch(predFn, /coalesce/i);
  const attachFn = scopeLib.slice(
    scopeLib.indexOf("async function attachFinanceMembershipScope"),
    scopeLib.indexOf("function attachFinanceFixtureScope"),
  );
  assert.match(attachFn, /SELECT s\.login_code/);
  assert.doesNotMatch(attachFn, /coalesce\(nullif\(btrim\(s\.login_code\)/);
  assert.match(attachFn, /\(platform \|\| adminPays\) && requestScoped/);
  const itemsProjection = pgStore.slice(
    pgStore.indexOf("FROM school_fee_items i"),
    pgStore.indexOf("FROM student_fee_obligations o"),
  );
  assert.match(itemsProjection, /s\.login_code/);
  const findFn = scopeLib.slice(
    scopeLib.indexOf("async function findEmittedLoginCode"),
    scopeLib.indexOf("async function attachFinanceMembershipScope"),
  );
  assert.doesNotMatch(findFn, /\sOR\s/i);
  assert.doesNotMatch(findFn, /coalesce/i);
  const getSchoolFn = pgStore.slice(pgStore.indexOf("async getSchoolByCode"), pgStore.indexOf("async mapSchoolRow"));
  assert.doesNotMatch(getSchoolFn, /school_code/);
  const resolveWriteFn = pgStore.slice(
    pgStore.indexOf("async resolveSchoolForScopedWrite"),
    pgStore.indexOf("async findStudent"),
  );
  assert.match(resolveWriteFn, /login_code/);
  assert.doesNotMatch(resolveWriteFn, /\sOR\s/i);
  assert.doesNotMatch(resolveWriteFn, /coalesce/i);
  assert.match(service, /resolveSchoolForScopedWrite/);
  const loadWriteFn = service.slice(
    service.indexOf("async function loadSchoolForWrite"),
    service.indexOf("function actorName"),
  );
  assert.match(loadWriteFn, /scope\.mode === "country"/);
  assert.match(loadWriteFn, /primaryFinanceSchoolCode/);
  const listClassFn = pgStore.slice(pgStore.indexOf("async listStudentsInClass"), pgStore.indexOf("async listPaymentCodes"));
  assert.doesNotMatch(listClassFn, /OR upper\(btrim\(s\.school_code\)\)/);
  assert.match(pgStore, /withFinancePrincipal/);
  assert.match(pgStore, /attachFinanceMembershipScope/);
  assert.match(server, /function financeHttpPrincipal/);
  assert.match(read("backend/services/tenantScopeService.js"), /principal\.financeLoginCode/);
  assert.match(httpTest, /P0 leftover ≠ login_code du même tenant/);
  assert.match(httpTest, /leftover JWT n'est pas l'autorité Finance/);
  assert.match(read("backend/lib/financeMembershipScope.pg.test.js"), /P0-4: leftover jamais promu/);
  assert.match(read("backend/lib/financeMembershipScope.pg.test.js"), /Admin Pays CD ne peut pas écrire école BI/);
  assert.match(read("backend/lib/financeMembershipScope.pg.test.js"), /Admin Pays refuse école CD sans login_code/);
  const management = read("backend/lib/financeManagement.js");
  const mappedFn = management.slice(
    management.indexOf("function mappedSchoolCode"),
    management.indexOf("function mapPaymentRow"),
  );
  assert.doesNotMatch(mappedFn, /school_code/);

  const assertTenant = service.slice(
    service.indexOf("function assertTenant"),
    service.indexOf("function resolveActorSchoolCode"),
  );
  assert.match(assertTenant, /resolveFinanceSchoolScope/);
  assert.match(assertTenant, /schoolRecordInFinanceScope/);
  assert.match(assertTenant, /scope\.mode === ["']country["']/);
  assert.doesNotMatch(assertTenant, /if \(!scope \|\| scope === "\*"\) return/);

  assert.match(httpTest, /F8-P0-004 GET paiement B schoolCode vide/);
  assert.match(httpTest, /schoolCode: ""/);
  assert.match(httpTest, /F8-P0-004 compteur paiements B inchangé/);
  assert.match(httpTest, /F8-P0-004 aucune payment_reminders B créée/);
  assert.match(httpTest, /F8-P0-004 Superadmin request-scoped A ne paie pas B/);
  assert.match(httpTest, /F8-P0-004 Superadmin global n'accède pas aux paiements élève/);
  assert.match(httpTest, /F8-P1-006 Admin Pays CI ne paie pas A/);
  assert.match(httpTest, /F8-P1-006 Admin Pays CI crée grille A/);
  assert.match(httpTest, /F8-P1-006 Admin Pays CI refuse grille B/);
  assert.match(httpTest, /CI-TRAP-26-001/);
  assert.match(httpTest, /F8-P1-006 Admin Pays CI refuse paiement piège préfixe CI/);

  assert.match(cash, /void method/);
  assert.doesNotMatch(cash, /En attente de confirmation/);
  assert.match(httpTest, /Mobile money doit être imputé/);

  assert.match(service, /requireSchoolCurrency/);
  assert.doesNotMatch(service, /school\.currency \|\| ["']CDF["']/);
  assert.doesNotMatch(catalog, /\|\| ["']CDF["']/);
  assert.match(lifecycle, /aucun repli CDF\/USD\/EUR/);
  assert.doesNotMatch(unpaidWeb, /\?\? ["']USD["']/);
  assert.doesNotMatch(unpaidBe, /\?\? ["']USD["']/);

  assert.match(modal, /idempotencyKey: paymentIntentionRef\.current/);
  assert.match(entity, /idempotencyKey: cancelIntentionRef\.current/);
  assert.match(feesPage, /idempotencyKey: applyIntentionRef/);
  assert.match(unpaidPage, /idempotencyKey: reminderIntentionRef\.current/);
  assert.match(api, /Idempotency-Key/);
  assert.match(mobileControls, /createSchoolPayment\(payload, \{ idempotencyKey \}\)/);
  assert.match(outbox, /OUTBOX_DOMAIN_FORBIDDEN/);
  assert.match(schema, /ALTER TABLE student_fee_obligations ALTER COLUMN currency DROP DEFAULT/);
  assert.match(schema, /ALTER TABLE fee_grids ALTER COLUMN currency DROP DEFAULT/);
  assert.match(server, /routeKey: `POST \/api\/backoffice\/finance\/unpaid\/\$\{req\.params\.studentId\}\/reminders`/);
  assert.match(httpTest, /seconde application sans obligation dupliquée/);
  assert.match(httpTest, /annulation restaure le solde/);
  assert.match(httpTest, /revoke stale JWT/);
  assert.match(httpTest, /devise A doit être XOF/);
  assert.doesNotMatch(modal, /role === ["']Comptable["']/);
  assert.doesNotMatch(mobileControls, /role === ["']Comptable["']/);

  console.log("verify-finance-readiness: source guards F8 OK");
}

function main() {
  sourceGuards();
  run(
    process.execPath,
    ["--test", "backend/lib/financeUnallocatedCash.test.js", "backend/lib/financeCatalog.test.js", "backend/lib/financeSchoolScope.test.js"],
    "tests unitaires caisse / catalogue F8 ont échoué",
  );
  run(
    "npm",
    ["--prefix", "web", "run", "test", "--", "src/lib/unpaidModule.currency.test.ts", "src/lib/financeCurrency.test.ts"],
    "tests devise Web F8 ont échoué",
  );
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour le parcours PostgreSQL F8");
  run(process.execPath, ["backend/lib/financeMembershipScope.pg.test.js"], "preuve leftover ≠ login_code GP-005 a échoué");
  run(process.execPath, ["backend/lib/financeReadiness.http.pg.test.js"], "parcours HTTP PostgreSQL F8 a échoué");
  console.log("verify-finance-readiness: GO — PostgreSQL réel inclus");
}

main();
