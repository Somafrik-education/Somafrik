"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function sourceGuards() {
  const service = read("backend/lib/financeService.js");
  const paid = read("backend/lib/financeObligationPaid.js");
  const schema = read("backend/db/financeSchema.js");
  const migration = read("backend/db/migrations/20260828_finance_f4_allocation_balance.sql");

  assert.match(service, /FINANCE_OBLIGATION_ID_REQUIRED/);
  assert.match(service, /FINANCE_LEGACY_RECONCILE_DISABLED/);
  assert.match(service, /assertPaymentConservation/);
  assert.match(service, /assertCompatibleCurrency/);

  const createStart = service.indexOf("async function createPayment");
  const cancelStart = service.indexOf("async function cancelPayment", createStart);
  assert.ok(createStart >= 0 && cancelStart > createStart, "createPayment introuvable");
  const createPayment = service.slice(createStart, cancelStart);
  assert.doesNotMatch(createPayment, /reconcileUnallocatedPaymentsInTx/);
  assert.doesNotMatch(createPayment, /openObligationsMatchingFeeType/);
  assert.match(createPayment, /obligationId est requis pour imputer un paiement/);
  assert.match(createPayment, /feeLabel = "Non imputé"/);

  assert.doesNotMatch(paid, /Math\.max\(money\(fee\.amountPaid\),\s*fromAlloc\)/);
  assert.match(paid, /withPaidAmount\(fee, fromAlloc\)/);

  for (const ddl of [schema, migration]) {
    assert.match(ddl, /payment_allocations_assert_canonical/);
    assert.match(ddl, /FOR UPDATE/);
    assert.match(ddl, /FINANCE_ALLOCATION_TENANT_MISMATCH/);
    assert.match(ddl, /FINANCE_ALLOCATION_STUDENT_MISMATCH/);
    assert.match(ddl, /FINANCE_PAYMENT_OVERALLOCATED/);
    assert.match(ddl, /FINANCE_OBLIGATION_OVERALLOCATED/);
    assert.match(ddl, /FINANCE_PAYMENT_NOT_SETTLED/);
    assert.match(ddl, /student_fee_obligations_project_allocations/);
    assert.match(ddl, /SUM\(pa\.amount\)/);
    assert.match(ddl, /GREATEST\(0, COALESCE\(NEW\.amount_due, 0\) - allocated - COALESCE\(NEW\.exemption, 0\)\)/);
  }

  assert.doesNotMatch(migration, /CREATE TABLE\s+student_balances/i);
  assert.doesNotMatch(migration, /CREATE TABLE\s+student_debts/i);
  assert.doesNotMatch(migration, /CREATE TABLE\s+student_invoices/i);
  console.log("verify-finance-allocation-balance: source guards OK");
}

function run(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, label);
}

function main() {
  sourceGuards();
  run(["--test", path.join(ROOT, "backend/lib/financeAllocationBalance.test.js")], "F4 mémoire a échoué");
  run([path.join(ROOT, "backend/lib/financeAllocationBalance.pg.test.js")], "F4 PostgreSQL a échoué");
  console.log("verify-finance-allocation-balance: GO");
}

main();