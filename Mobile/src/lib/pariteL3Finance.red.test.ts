/**
 * Lot Finance L3 — écarts causaux Mobile (inspection du code livré).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "FIN-L3-01-MOBILE",
    title: "Paiements Mobile utilise la ventilation par devise (même contrat Web)",
    run() {
      const payments = read("screens/PaymentsScreen.tsx");
      const student = read("screens/StudentPaymentsScreen.tsx");
      assert.match(
        payments,
        /formatPaymentOverviewAmounts|getPaymentAmountBreakdown/,
        "PaymentsScreen formate encore getPaymentRateKpi + catalogCurrency",
      );
      assert.match(
        student,
        /formatPaymentOverviewAmounts|getPaymentAmountBreakdown/,
        "StudentPaymentsScreen formate encore getPaymentRateKpi + catalogCurrency",
      );
    },
  },
  {
    id: "FIN-L3-04-A-MOBILE",
    title: "Cash Mobile ventilé par devise du paiement, pas catalogCurrency",
    run() {
      const payments = read("screens/PaymentsScreen.tsx");
      const student = read("screens/StudentPaymentsScreen.tsx");
      const normalize = read("lib/dataTruth.ts");
      const fnStart = normalize.indexOf("export function normalizePaymentRow");
      const fn = normalize.slice(fnStart, fnStart + 1800);
      assert.match(
        fn,
        /currency:/,
        "normalizePaymentRow jette encore GET /payments.currency",
      );
      assert.match(
        payments,
        /formatPaymentCashAmounts|getPaymentCashBreakdown/,
        "PaymentsScreen formate encore cashKpi.collectedAmount + catalogCurrency",
      );
      assert.doesNotMatch(
        payments,
        /moneyLabel\(cashKpi\.collectedAmount, paymentsReady, catalogCurrency\)/,
        "Montant encaissé Mobile additionne encore le cash sous catalogCurrency",
      );
      assert.match(
        student,
        /formatPaymentCashAmounts|getPaymentCashBreakdown/,
        "StudentPaymentsScreen formate encore l'encaissé avec catalogCurrency",
      );
    },
  },
  {
    id: "FIN-L3-04-E-MOBILE",
    title: "unallocatedAmount canonique, jamais collected - allocated",
    run() {
      const cash = read("lib/paymentCashKpi.ts");
      const normalize = read("lib/dataTruth.ts");
      const fnStart = normalize.indexOf("export function normalizePaymentRow");
      const fn = normalize.slice(fnStart, fnStart + 1800);
      assert.doesNotMatch(cash, /collected - allocated/);
      assert.doesNotMatch(cash, /Math\.max\(0,\s*collected/);
      assert.doesNotMatch(
        fn,
        /row\.amount \?\? row\.totalAmount \?\? 0\) - Number\(row\.allocatedAmount/,
        "normalizePaymentRow reconstruit encore unallocated = amount - allocated",
      );
    },
  },
  {
    id: "FIN-L3-05-A1",
    title: "CanonicalStudentFee / normalizeStudentFeeRow préservent currency",
    run() {
      const api = read("services/api.ts");
      const typeStart = api.indexOf("export type CanonicalStudentFee");
      const typeBlock = api.slice(typeStart, api.indexOf("function normalizeStudentFeeRow"));
      assert.match(typeBlock, /currency/, "CanonicalStudentFee n'a pas currency — GET /finance/student-fees est jeté");
      const fnStart = api.indexOf("function normalizeStudentFeeRow");
      const fn = api.slice(fnStart, api.indexOf("export function getStudentFees"));
      assert.match(fn, /row\.currency/, "normalizeStudentFeeRow ne lit pas row.currency");
      assert.match(fn, /currency:/, "normalizeStudentFeeRow n'écrit pas currency");
    },
  },
  {
    id: "FIN-L3-05-B1-MOBILE",
    title: "Encaissé Mobile exclut brouillon comme le Web",
    run() {
      const cash = read("lib/paymentCashKpi.ts");
      const fnStart = cash.indexOf("export function isCountedMobileCashPayment");
      const fn = cash.slice(fnStart, fnStart + 700);
      assert.match(fn, /brouillon/, "Mobile compte encore les brouillons dans l'encaissé (+200 CDF)");
    },
  },
  {
    id: "FIN-L3-05-C4",
    title: "Home n'affiche plus de suffixe F sur les KPI financiers",
    run() {
      const home = read("screens/HomeScreen.tsx");
      assert.doesNotMatch(
        home,
        /formatAmount\(paymentStats\.pendingAmount\)/,
        "À percevoir Home n'est pas le reste dû des obligations",
      );
      assert.doesNotMatch(
        home,
        /formatAmount\(cashKpi\.collectedAmount\)/,
        "Encaissé Home n'est pas le ledger cash Paiements",
      );
      const formatStart = home.indexOf("function formatAmount");
      if (formatStart >= 0) {
        const formatFn = home.slice(formatStart, formatStart + 180);
        assert.doesNotMatch(formatFn, /\} F`/, "suffixe générique F encore utilisé pour un KPI financier");
      }
    },
  },
];

let failed = 0;
for (const item of cases) {
  try {
    item.run();
    console.log(`PASS ${item.id} ${item.title}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.id} ${item.title}`);
    console.error(error instanceof Error ? error.message : error);
  }
}
if (failed) {
  process.exitCode = 1;
  console.error(`\nRED ${failed}/${cases.length} cas FIN-L3 Mobile encore ouverts`);
} else {
  console.log(`\nGREEN ${cases.length}/${cases.length} cas FIN-L3 Mobile`);
}
