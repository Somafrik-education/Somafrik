"use strict";

/**
 * F7 — Gate UX Finance Web + Mobile.
 * F1–F6 inchangés. Aucune reconstruction backend.
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

const webModal = read("web/src/components/payments/QuickPaymentModal.tsx");
const webFees = read("web/src/pages/finances/FinanceFeesPage.tsx");
const webUnpaid = read("web/src/pages/finances/FinanceUnpaidPage.tsx");
const webSettings = read("web/src/pages/parametres/SettingsFinancePage.tsx");
const webActions = read("web/src/lib/financeActionPermissions.ts");
const webUnpaidPerm = read("web/src/lib/unpaidPermissions.ts");
const webFeePerm = read("web/src/lib/feePermissions.ts");
const mobileControls = read("Mobile/src/components/PaymentMutationControls.tsx");
const mobilePayments = read("Mobile/src/screens/PaymentsScreen.tsx");
const mobileStudent = read("Mobile/src/screens/StudentPaymentsScreen.tsx");
const mobileReceipt = read("Mobile/src/components/PaymentReceiptCard.tsx");
const currencyWeb = read("web/src/lib/financeCurrency.ts");
const currencyMobile = read("Mobile/src/lib/financeCurrency.ts");

for (const [label, source] of [
  ["QuickPaymentModal", webModal],
  ["FinanceFeesPage", webFees],
  ["FinanceUnpaidPage", webUnpaid],
  ["SettingsFinancePage", webSettings],
  ["financeActionPermissions", webActions],
  ["unpaidPermissions", webUnpaidPerm],
  ["feePermissions", webFeePerm],
  ["PaymentMutationControls", mobileControls],
]) {
  assert.doesNotMatch(source, /role === ["']Admin School["']/, `${label}: pas de rôle Admin School`);
  assert.doesNotMatch(source, /role === ["']Comptable["']/, `${label}: pas de rôle Comptable`);
  assert.doesNotMatch(source, /role === ["']Super Admin/, `${label}: pas de rôle Super Admin`);
}

assert.match(webModal, /if \(!selectedStudent \|\| busyRef\.current\) return/);
assert.match(mobileControls, /if \(saving\) return/);
assert.match(webModal, /Enregistrement…/);
assert.match(mobileControls, /Encaissement enregistré/);
assert.match(webModal, /OpenObligationCards/);
assert.match(mobileControls, /Frais encore dus/);
assert.match(mobileControls, /canRecordSchoolPayment/);
assert.match(webFees, /canReadFees\(ctx\)/);
assert.doesNotMatch(webFees, /canViewFeeGrids/);
assert.match(webSettings, /canReadFees\(ctx\)/);
assert.match(webUnpaidPerm, /hasBackOfficePermission\(ctx, UNPAID_FEATURE, "READ"\)/);
assert.match(webUnpaidPerm, /hasBackOfficePermission\(ctx, "Paiements", "UPDATE"\)/);
assert.match(webFeePerm, /hasBackOfficePermission\(ctx, FEE_FEATURE, "READ"\)/);
assert.match(webFeePerm, /FEE_FEATURE, "CREATE"\)/);
assert.match(webFeePerm, /FEE_FEATURE, "UPDATE"/);
assert.match(webActions, /FINANCE_PAYMENT_FEATURE, "CREATE"\)/);
assert.match(webActions, /FINANCE_PAYMENT_FEATURE, "UPDATE"/);
assert.match(read("web/src/pages/EntityPage.tsx"), /financeActions\.canCreatePayment/);
assert.doesNotMatch(currencyWeb, /"USD"|"EUR"/);
assert.doesNotMatch(currencyMobile, /"USD"|"EUR"/);
assert.doesNotMatch(mobilePayments, / FC/);
assert.doesNotMatch(mobileStudent, / FC/);
assert.doesNotMatch(mobileReceipt, / FC/);
assert.match(webModal, /Ajouter une ligne de frais/);
assert.match(webModal, /Enregistrer l'encaissement/);
assert.match(webModal, /Chargement du catalogue financier/);
assert.match(webFees, /EmptyState/);
assert.match(webUnpaid, /Aucun reste à payer/);

run("npx", ["--yes", "tsx", "Mobile/src/lib/financeCurrency.test.ts"], "mobile financeCurrency");
run("npx", ["--yes", "tsx", "Mobile/src/lib/mobileCrudParity.test.ts"], "mobile F6 payment OR");
run("npm", ["--prefix", "web", "run", "test", "--",
  "src/lib/financeCurrency.test.ts",
  "src/lib/financeObligationStatus.test.ts",
  "src/lib/financeActionPermissions.test.ts",
  "src/lib/financeUiRbac.test.ts",
  "src/components/payments/OpenObligationCards.test.tsx",
  "src/components/payments/PaymentReceipt.test.tsx",
  "src/pages/entity-page/entityColumns.test.tsx",
  "src/pages/parametres/SettingsFinancePage.test.tsx",
], "web F7 UX tests");

console.log("verify-finance-ux OK");
