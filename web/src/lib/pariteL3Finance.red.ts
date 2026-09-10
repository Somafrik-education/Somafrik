/**
 * Lot Finance L3 — écarts causaux Web (inspection du code livré).
 * Doivent échouer sur develop@19e7afc0 avant implémentation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(webRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "FIN-L3-01-A",
    title: "Paiements Web n'affiche plus un 0 USD artificiel si CDF+USD",
    run() {
      const overview = read("components/payments/FinancePaymentsOverview.tsx");
      const entity = read("pages/EntityPage.tsx");
      assert.doesNotMatch(
        overview,
        /formatFinanceAmount\(expectedAmount, currency\)/,
        "FinancePaymentsOverview formate encore un scalaire unique (0 + devise école)",
      );
      assert.match(
        entity,
        /buildFinancePaymentsOverview|formatPaymentOverviewAmounts|getPaymentAmountBreakdown/,
        "EntityPage Paiements s'appuie encore sur getPaymentRateKpi.expectedAmount=0 + devise école",
      );
    },
  },
  {
    id: "FIN-L3-01-B",
    title: "Montants attendu/encaissé/reste ventilés par devise",
    run() {
      const overview = read("components/payments/FinancePaymentsOverview.tsx");
      assert.match(
        overview,
        /expectedLabel|amountLines|buckets/,
        "FinancePaymentsOverview n'accepte pas encore des libellés / lignes par devise",
      );
    },
  },
  {
    id: "FIN-L3-02",
    title: "Compteur Paiements scopé via scopedStudentFees (pas state.studentFees brut)",
    run() {
      const entity = read("pages/EntityPage.tsx");
      const helper = read("lib/paymentAmountBreakdown.ts");
      const paymentOverview = entity.slice(entity.indexOf("paymentOverview"));
      assert.match(
        paymentOverview,
        /buildFinancePaymentsOverview|scopedStudentFees/,
        "EntityPage compte encore state.studentFees hors scope établissement",
      );
      assert.match(
        helper,
        /scopedStudentFees/,
        "la synthèse Paiements n'applique pas scopedStudentFees",
      );
    },
  },
  {
    id: "FIN-L3-03",
    title: "Libellé KPI Obligations élèves",
    run() {
      const overview = read("components/payments/FinancePaymentsOverview.tsx");
      assert.match(overview, /Obligations élèves/, "libellé encore « Obligations »");
      assert.doesNotMatch(
        overview,
        /label=["']Obligations["']/,
        "libellé ambigu « Obligations » encore présent",
      );
      assert.doesNotMatch(overview, /Frais configurés|label=["']Tarifs["']/);
    },
  },
  {
    id: "FIN-L3-04-A",
    title: "Cash Web/Mobile ventilé par devise, jamais catalogCurrency",
    run() {
      const entity = read("pages/EntityPage.tsx");
      const helper = read("lib/paymentAmountBreakdown.ts");
      const cash = read("lib/paymentCashKpi.ts");
      assert.match(
        cash,
        /getPaymentCashBreakdown|formatPaymentCashAmounts/,
        "le cash Web n'est pas ventilé par devise du paiement",
      );
      assert.match(
        helper,
        /formatPaymentCashAmounts|getPaymentCashBreakdown|scopedPayments/,
        "la synthèse Paiements n'utilise pas le ledger cash par devise",
      );
      assert.match(
        entity,
        /buildFinancePaymentsOverview/,
      );
    },
  },
  {
    id: "FIN-L3-04-C",
    title: "Montant encaissé = cash ; amountPaid = Montant imputé aux obligations",
    run() {
      const overview = read("components/payments/FinancePaymentsOverview.tsx");
      assert.match(
        overview,
        /Montant imputé aux obligations/,
        "amountPaid est encore libellé Montant encaissé",
      );
      const encaissé = overview.indexOf('label="Montant encaissé"');
      const imputé = overview.indexOf("Montant imputé aux obligations");
      assert.ok(encaissé >= 0 && imputé >= 0, "les deux libellés doivent coexister");
      assert.notEqual(encaissé, imputé);
    },
  },
  {
    id: "FIN-L3-04-E",
    title: "unallocatedAmount canonique, jamais collected - allocated",
    run() {
      const cash = read("lib/paymentCashKpi.ts");
      assert.doesNotMatch(cash, /collected - allocated/);
      assert.doesNotMatch(cash, /Math\.max\(0,\s*collected/);
    },
  },
  {
    id: "FIN-L3-05-B1",
    title: "Encaissé Web exclut brouillon comme le contrat métier",
    run() {
      const cash = read("lib/paymentCashKpi.ts");
      const fnStart = cash.indexOf("export function isCountedCashPayment");
      const fn = cash.slice(fnStart, fnStart + 700);
      assert.match(fn, /brouillon/, "Web doit exclure les brouillons de l'encaissé");
    },
  },
  {
    id: "FIN-L3-05-D1",
    title: "Frais & tarifs Reste à payer ventilé, jamais 1 091 001 CDF",
    run() {
      const page = read("pages/finances/FinanceFeesPage.tsx");
      assert.doesNotMatch(
        page,
        /formatFinanceAmount\(summary\.totalBalance,\s*currency\)/,
        "Frais & tarifs somme encore les soldes puis les étiquette avec catalogCurrency",
      );
      assert.match(
        page,
        /formatPaymentOverviewAmounts|remainingLabel|formatFeeRemainingLabel/,
        "Frais & tarifs n'utilise pas le reste dû par devise des obligations",
      );
    },
  },
  {
    id: "FIN-L3-06-B3",
    title: "Montant encaissé Web = payment.amount, jamais SUM(items)",
    run() {
      const cash = read("lib/paymentCashKpi.ts");
      assert.match(
        cash,
        /parseMoney\(payment\.amount \?\? payment\.totalAmount\)/,
        "le cash Web doit rester payment.amount (fallback totalAmount)",
      );
      assert.doesNotMatch(cash, /items\.reduce/);
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
  console.error(`\nRED ${failed}/${cases.length} cas FIN-L3 encore ouverts`);
} else {
  console.log(`\nGREEN ${cases.length}/${cases.length} cas FIN-L3 Web`);
}
