/**
 * FIN-L3-05-C — Home Mobile : À percevoir = reste Paiements, Encaissé = ledger cash.
 *   npx tsx Mobile/src/lib/homeFinanceKpis.l305.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatPaymentOverviewAmounts } from "./paymentAmountBreakdown";
import { formatPaymentCashAmounts } from "./paymentCashKpi";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = fs.readFileSync(path.join(srcRoot, "screens/HomeScreen.tsx"), "utf8");
const layout = fs.readFileSync(path.join(srcRoot, "components/RoleDashboardLayout.tsx"), "utf8");

function run() {
  const fees = [
    { studentId: "s-cdf", amountDue: 1_840_500, amountPaid: 750_499, exemption: 0, status: "À payer", currency: "CDF" },
    { studentId: "s-usd", amountDue: 3_100, amountPaid: 2_100, exemption: 0, status: "À payer", currency: "USD" },
  ];
  const remaining = formatPaymentOverviewAmounts(fees).remainingLabel;
  assert.match(remaining, /1[\s\u00a0\u202f]?090[\s\u00a0\u202f]?001 CDF/, "FIN-L3-05-C1");
  assert.match(remaining, /1[\s\u00a0\u202f]?000 USD/, "FIN-L3-05-C1");
  assert.equal(/1[\s\u00a0\u202f]?091[\s\u00a0\u202f]?001/.test(remaining), false);
  assert.equal(/ F$/.test(remaining.split("\n")[0] ?? ""), false, "FIN-L3-05-C4");

  const cash = formatPaymentCashAmounts([
    { amount: 754_250, currency: "CDF", status: "Payé", allocatedAmount: 754_250, unallocatedAmount: 0 },
    { amount: 200, currency: "CDF", status: "Brouillon", allocatedAmount: 0, unallocatedAmount: 200 },
  ]);
  assert.match(cash.collectedLabel, /754[\s\u00a0\u202f]?250 CDF/, "FIN-L3-05-C2");
  assert.equal(/754[\s\u00a0\u202f]?450/.test(cash.collectedLabel), false, "FIN-L3-05-C2");

  const mixedCash = formatPaymentCashAmounts([
    { amount: 754_250, currency: "CDF", status: "Payé" },
    { amount: 50, currency: "USD", status: "Payé" },
  ]);
  assert.match(mixedCash.collectedLabel, /CDF/, "FIN-L3-05-C3");
  assert.match(mixedCash.collectedLabel, /USD/, "FIN-L3-05-C3");

  assert.match(home, /formatPaymentOverviewAmounts|remainingLabel/, "FIN-L3-05-C1 Home À percevoir");
  assert.match(home, /formatPaymentCashAmounts/, "FIN-L3-05-C2 Home Encaissé");
  assert.doesNotMatch(home, /formatAmount\(paymentStats\.pendingAmount\)/);
  assert.doesNotMatch(home, /formatAmount\(cashKpi\.collectedAmount\)/);
  assert.match(home, /studentFeesReady|"—"/, "FIN-L3-05-C5 jamais faux zéro");
  assert.match(layout, /numberOfLines=\{2\}/, "FIN-L3-05-C Home KPI deux lignes si besoin");
}

run();
console.log("PASS Mobile FIN-L3-05-C homeFinanceKpis");
