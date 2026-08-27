"use strict";

/**
 * F3 — Gate naissance des obligations financières.
 * Pas de serveur HTTP. Pas de nouvelle table dette concurrente.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function readRepo(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertSourceGuards() {
  const lifecycle = readRepo("backend/lib/financeObligationLifecycle.js");
  const service = readRepo("backend/lib/financeService.js");
  const schema = readRepo("backend/db/financeSchema.js");
  const pgStore = readRepo("backend/db/financePgStore.js");
  const memory = readRepo("backend/db/financeMemoryStore.js");
  const pgRepo = readRepo("backend/db/postgresRepository.js");
  const fees = readRepo("web/src/pages/finances/FinanceFeesPage.tsx");
  const quickModal = readRepo("web/src/components/fees/QuickFeeGridModal.tsx");
  const quick = readRepo("web/src/lib/quickPayment.ts");
  const paymentTx = readRepo("backend/services/paymentTransactionService.js");
  const errors = readRepo("backend/lib/financeManagement.js");
  const ddl = readRepo("backend/db/schema.sql");
  const migration = readRepo("backend/db/migrations/20260827_finance_f3_obligation_lifecycle.sql");
  assert.match(errors, /ENROLLMENT_NOT_FOUND: "FINANCE_ENROLLMENT_NOT_FOUND"/);
  assert.match(errors, /CLASS_ENROLLMENT_MISMATCH: "FINANCE_CLASS_ENROLLMENT_MISMATCH"/);
  assert.match(errors, /NEEDS_EFFECTIVE_DATE: "FINANCE_NEEDS_EFFECTIVE_DATE"/);
  assert.match(errors, /OBLIGATION_SYNC_FAILED: "FINANCE_OBLIGATION_SYNC_FAILED"/);

  assert.match(lifecycle, /ensureEnrollmentFinanceObligations/);
  assert.match(lifecycle, /NO_APPLICABLE_FINANCE_GRID/);
  assert.match(lifecycle, /CLASS_TRANSFER/);
  assert.match(lifecycle, /FINANCE_ERROR\.ENROLLMENT_NOT_FOUND/);
  assert.match(lifecycle, /FINANCE_ERROR\.CLASS_ENROLLMENT_MISMATCH/);
  assert.match(lifecycle, /FINANCE_ERROR\.NEEDS_EFFECTIVE_DATE/);
  assert.match(lifecycle, /FINANCE_ERROR\.GRID_ENROLLMENT_MISMATCH/);
  assert.match(lifecycle, /finance_obligation_sync_failed/);
  assert.doesNotMatch(lifecycle, /gridMatchesEnrollment\(grid, enrollment\) \|\| input\.grid/);
  assert.doesNotMatch(lifecycle, /DEFAULT_FEE_AMOUNTS/);
  assert.doesNotMatch(lifecycle, /new Date\(\)\.getFullYear\(\)/);

  assert.match(service, /ensureEnrollmentFinanceObligationsInTx/);
  assert.match(service, /OBLIGATION_LIFECYCLE_REASON\.GRID_APPLY/);
  assert.doesNotMatch(
    service.slice(service.indexOf("async function createPayment"), service.indexOf("async function cancelPayment")),
    /insertObligationIfAbsent/,
    "createPayment ne doit pas insérer d'obligation",
  );

  assert.match(schema, /student_fee_obligations_identity_uniq/);
  assert.match(schema, /period_key/);
  assert.match(schema, /fee_type_code/);
  assert.doesNotMatch(schema, /CREATE TABLE student_debts/);
  assert.doesNotMatch(schema, /CREATE TABLE student_invoices/);
  assert.doesNotMatch(ddl, /CREATE TABLE IF NOT EXISTS student_debts/);
  assert.doesNotMatch(migration, /enrollment_date, CURRENT_DATE\)/);
  assert.match(migration, /SET class_effective_date = enrollment_date/);

  assert.match(pgStore, /period_key/);
  assert.match(pgStore, /23505/);
  assert.match(memory, /period_key/);

  assert.match(pgRepo, /syncEnrollmentFinanceObligations/);
  assert.match(pgRepo, /enrollment_active/);
  assert.match(pgRepo, /class_transfer/);
  assert.match(pgRepo, /FINANCE_OBLIGATION_SYNC_FAILED/);
  assert.doesNotMatch(pgRepo, /classChanged \? new Date\(\)/);
  assert.doesNotMatch(pgRepo, /THEN COALESCE\(\$5::date, CURRENT_DATE\)/);
  assert.doesNotMatch(pgRepo, /console\.warn\("finance F3 ensureEnrollmentObligations/);

  assert.match(fees, /financeApi\.applyFeeGrid/);
  assert.doesNotMatch(fees, /applyFeeGridToStudents/);
  assert.doesNotMatch(quickModal, /applyFeeGridToStudents/);

  assert.match(quick, /DEFAULT_FEE_AMOUNTS/);
  assert.doesNotMatch(
    lifecycle,
    /DEFAULT_FEE_AMOUNTS/,
    "DEFAULT_FEE_AMOUNTS n'est pas une autorité d'obligation",
  );
  assert.doesNotMatch(paymentTx, /insertObligationIfAbsent/);
  assert.doesNotMatch(paymentTx, /student_fee_obligations/);

  console.log("verify-finance-obligation-lifecycle: source guards OK");
}

function run(cmd, args, failMessage) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, failMessage);
}

function main() {
  assertSourceGuards();
  run(process.execPath, [path.join(ROOT, "backend/scripts/verify-finance-domain-invariants.js")], "F1 a échoué");
  run(process.execPath, [path.join(ROOT, "backend/scripts/verify-finance-fee-type-canonical.js")], "F2 a échoué");
  run(
    process.execPath,
    [
      "--test",
      path.join(ROOT, "backend/lib/financeObligationPeriod.test.js"),
      path.join(ROOT, "backend/lib/financeObligationLifecycle.test.js"),
    ],
    "tests F3 mémoire ont échoué",
  );
  run(
    process.execPath,
    [path.join(ROOT, "backend/lib/financeObligationLifecycle.pg.test.js")],
    "tests F3 PostgreSQL ont échoué",
  );
  console.log("verify-finance-obligation-lifecycle: GO");
}

main();
