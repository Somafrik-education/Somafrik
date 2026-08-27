"use strict";

/**
 * F2 — Gate référentiel unique des types de frais.
 * Pas de serveur HTTP. Pas de nouvelle table générique.
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
  const types = readRepo("backend/lib/financeFeeTypes.js");
  const catalog = readRepo("backend/lib/financeCatalog.js");
  const match = readRepo("backend/lib/financeFeeTypeMatch.js");
  const service = readRepo("backend/lib/financeService.js");
  const fees = readRepo("web/src/lib/fees.ts");
  const quick = readRepo("web/src/lib/quickPayment.ts");
  const enrollment = readRepo("Mobile/src/lib/paymentEnrollment.ts");
  const mutation = readRepo("Mobile/src/components/PaymentMutationControls.tsx");
  const schema = readRepo("backend/db/schema.sql");

  assert.match(types, /CANONICAL_FEE_TYPE_CATALOG/);
  assert.match(types, /code: "TUITION"/);
  assert.match(types, /label: "Scolarité"/);
  assert.doesNotMatch(types, /label: "Acompte"/);
  assert.doesNotMatch(types, /label: "Mensualité"/);
  assert.doesNotMatch(types, /label: "Annexe"/);
  assert.doesNotMatch(types, /CREATE TABLE/);
  assert.doesNotMatch(types, /require\(["']pg["']\)/);
  assert.doesNotMatch(types, /currency: "FC"/);
  assert.doesNotMatch(types, /currency = "FC"/);

  assert.match(catalog, /require\(["']\.\/financeFeeTypes["']\)/);
  assert.match(catalog, /feeTypeCatalog/);
  assert.match(catalog, /activeFeeTypeCatalog/);

  assert.match(match, /require\(["']\.\/financeFeeTypes["']\)/);
  assert.match(match, /resolveFeeType/);
  assert.doesNotMatch(match, /isTuitionPayment/);

  assert.match(service, /persistableFeeType/);
  assert.match(service, /isUnallocatedFeeTypeInput/);
  assert.match(
    service,
    /persistableFeeType\(catalog\.feeType \|\| catalog\.label\)/,
    "createPayment feeTypeId doit canonicaliser en écriture, pas lire + fallback",
  );
  assert.match(
    service,
    /persistableFeeType\(target\.feeType\)/,
    "createPayment obligationId doit canonicaliser l'inférence en écriture",
  );
  assert.doesNotMatch(
    service,
    /resolved \? resolved\.feeType : catalog\.feeType/,
    "interdit le fallback brut catalog.feeType après resolveFeeType read",
  );
  assert.doesNotMatch(
    service,
    /resolved \? resolved\.feeType : target\.feeType/,
    "interdit de recopier le snapshot obligation legacy comme nouveau type",
  );
  assert.doesNotMatch(
    service,
    /mode:\s*["']read["']/,
    "createPayment n'utilise plus resolveFeeType en mode read pour une nouvelle écriture",
  );

  assert.doesNotMatch(fees, /SCHOOL_FEE_TYPES/);
  assert.doesNotMatch(quick, /export const FEE_TYPES/);
  assert.doesNotMatch(quick, /Minerval \/ scolarité/);

  assert.doesNotMatch(enrollment, /\|\| "Acompte"/);
  assert.doesNotMatch(mutation, /\|\| "Acompte"/);

  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS finance_settings/);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS fee_types/);

  console.log("verify-finance-fee-type-canonical: source guards OK");
}

function runUnitTests() {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      path.join(ROOT, "backend/lib/financeFeeTypes.test.js"),
      path.join(ROOT, "backend/lib/financeFeeTypeMatch.test.js"),
      path.join(ROOT, "backend/lib/financeCatalog.test.js"),
      path.join(ROOT, "backend/lib/financeFeeTypeWriteBypass.test.js"),
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "tests F2 fee types ont échoué");
}

function main() {
  assertSourceGuards();
  runUnitTests();
  const invariants = spawnSync(process.execPath, [path.join(ROOT, "backend/scripts/verify-finance-domain-invariants.js")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (invariants.stdout) process.stdout.write(invariants.stdout);
  if (invariants.stderr) process.stderr.write(invariants.stderr);
  assert.equal(invariants.status, 0, "verify:finance-domain-invariants a échoué");
  console.log("verify-finance-fee-type-canonical: GO");
}

main();
