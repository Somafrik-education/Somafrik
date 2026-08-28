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
  assert.match(memory, /schoolCodeInScope\(mapped\.schoolCode, scope\)/);

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
    ["--test", "backend/lib/financeUnallocatedCash.test.js", "backend/lib/financeCatalog.test.js"],
    "tests unitaires caisse / catalogue F8 ont échoué",
  );
  run(
    "npm",
    ["--prefix", "web", "run", "test", "--", "src/lib/unpaidModule.currency.test.ts", "src/lib/financeCurrency.test.ts"],
    "tests devise Web F8 ont échoué",
  );
  assert.ok(String(process.env.DATABASE_URL ?? "").trim(), "DATABASE_URL requis pour le parcours PostgreSQL F8");
  run(process.execPath, ["backend/lib/financeReadiness.http.pg.test.js"], "parcours HTTP PostgreSQL F8 a échoué");
  console.log("verify-finance-readiness: GO — PostgreSQL réel inclus");
}

main();
