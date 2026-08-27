"use strict";

/**
 * F1 — Gate de non-régression des invariants Finance.
 * Pas de serveur HTTP. Pas de mutation métier.
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
  const catalog = readRepo("backend/lib/financeCatalog.js");
  const invariants = readRepo("backend/lib/financeDomainInvariants.js");
  const management = readRepo("backend/lib/financeManagement.js");
  const unallocated = readRepo("backend/lib/financeUnallocatedCash.js");
  const paid = readRepo("backend/lib/financeObligationPaid.js");

  assert.match(catalog, /CANONICAL_FEE_TYPES/);
  assert.doesNotMatch(
    catalog.slice(catalog.indexOf("CANONICAL_FEE_TYPES"), catalog.indexOf("function isActiveStudentStatus")),
    /Acompte/,
    "Acompte ne doit pas entrer dans CANONICAL_FEE_TYPES",
  );

  assert.match(invariants, /function computeAllocatedAmount/);
  assert.match(invariants, /function computeUnallocatedAmount/);
  assert.match(invariants, /function computeObligationPaidAmount/);
  assert.match(invariants, /function computeObligationBalance/);
  assert.match(invariants, /function isPaymentFinanciallyActive/);
  assert.match(invariants, /function assertPaymentConservation/);
  assert.match(invariants, /discount\/réduction hors formule/);
  assert.match(invariants, /FORBIDDEN_CANONICAL_FEE_TYPES/);
  assert.match(invariants, /"Acompte"/);
  assert.doesNotMatch(
    invariants,
    /(?:^|[^_])CANONICAL_FEE_TYPES/,
    "F1 ne doit pas créer une 4e liste CANONICAL_FEE_TYPES",
  );
  assert.doesNotMatch(invariants, /CREATE TABLE/);
  assert.doesNotMatch(invariants, /require\(["']pg["']\)/);
  assert.doesNotMatch(invariants, /require\(["']\.\/financePgStore/);
  assert.doesNotMatch(invariants, /require\(["']express/);
  assert.doesNotMatch(invariants, /from ["']react/);
  assert.match(invariants, /FC: "CDF"/);
  assert.doesNotMatch(invariants, /currency = "FC"/);
  assert.doesNotMatch(invariants, /currency: "FC"/);

  assert.match(management, /require\(["']\.\/financeDomainInvariants["']\)/);
  assert.match(unallocated, /computeAllocatedAmount/);
  assert.match(unallocated, /computeUnallocatedAmount/);
  assert.match(paid, /projectObligationPaidAmounts/);

  const settings = readRepo("backend/db/schema.sql");
  assert.doesNotMatch(settings, /CREATE TABLE IF NOT EXISTS finance_settings/);

  console.log("verify-finance-domain-invariants: source guards OK");
}

function runUnitTests() {
  const result = spawnSync(
    process.execPath,
    ["--test", path.join(ROOT, "backend/lib/financeDomainInvariants.test.js")],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "financeDomainInvariants.test.js a échoué");
}

function main() {
  assertSourceGuards();
  runUnitTests();
  console.log("verify-finance-domain-invariants: GO");
}

main();
