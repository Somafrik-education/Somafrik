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
