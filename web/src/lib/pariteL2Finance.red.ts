/**
 * Lot Finance L2 — écarts causaux Web (inspection du code livré).
 * Doivent échouer sur develop@2e1eb11f.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(webRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "FIN-L2-01",
    title: "Impayés Web consomme GET /backoffice/finance/unpaid",
    run() {
      const page = read("pages/finances/FinanceUnpaidPage.tsx");
      const api = read("lib/financeApi.ts");
      assert.match(api, /listUnpaid:[\s\S]*\/backoffice\/finance\/unpaid/);
      assert.match(
        page,
        /financeApi\.listUnpaid|listUnpaid\(/,
        "FinanceUnpaidPage recalcule encore Impayés depuis studentFees au lieu du ledger GET unpaid",
      );
    },
  },
  {
    id: "FIN-L2-02",
    title: "Dashboard Impayés Web ne somme pas CDF+USD sous une devise",
    run() {
      const unpaidModule = read("lib/unpaidModule.ts");
      assert.match(
        unpaidModule,
        /totalsByCurrency/,
        "buildUnpaidDashboard n'expose pas les totaux par devise",
      );
      assert.doesNotMatch(
        unpaidModule,
        /totalAmountDue:\s*rows\.reduce\(\(sum, row\) => sum \+ row\.amountDue/,
        "totalAmountDue additionne encore toutes les lignes sans séparer les devises",
      );
    },
  },
  {
    id: "FIN-L2-03",
    title: "Oscar : Impayés Web nomme l'allocation, pas « déjà payé »",
    run() {
      const page = read("pages/finances/FinanceUnpaidPage.tsx");
      assert.equal(
        /Montant alloué aux impayés ouverts/.test(page),
        true,
        "le détail Impayés Web n'affiche pas « Montant alloué aux impayés ouverts » (Oscar)",
      );
      assert.equal(
        /déjà payé/.test(page),
        false,
        "la copie Impayés Web présente encore l'allocation comme « déjà payé »",
      );
      assert.equal(/Montant attendu/.test(page), true, "le détail Impayés Web n'affiche pas « Montant attendu »");
    },
  },
  {
    id: "FIN-L2-04",
    title: "Taux de paiement Web fail-closed si plusieurs devises coexistent",
    run() {
      const kpi = read("lib/paymentRateKpi.ts");
      assert.match(
        kpi,
        /currency\??:/,
        "StudentFeeObligation ignore encore la devise de l'obligation",
      );
      assert.match(
        kpi,
        /currencies\.size|mixedCurrency|distinctCurrenc/,
        "getPaymentRateKpi n'interrompt pas l'agrégat quand CDF et USD coexistent",
      );
    },
  },
  {
    id: "FIN-L2-06",
    title: "Impayés Web : 403/RBAC ≠ liste vide succès",
    run() {
      const page = read("pages/finances/FinanceUnpaidPage.tsx");
      const usesClientFeesOnly =
        /listUnpaidStudentFees/.test(page) && !/financeApi\.listUnpaid|listUnpaid\(/.test(page);
      const emptyLooksLikeSuccess = /Aucun reste à payer/.test(page);
      assert.equal(
        usesClientFeesOnly && emptyLooksLikeSuccess,
        false,
        "Impayés:READ sans studentFees voit encore « Aucun reste à payer » au lieu d'un ledger GET unpaid / état d'erreur",
      );
    },
  },
];

const failed: { id: string; title: string; message: string }[] = [];
const passedIds: string[] = [];
for (const testCase of cases) {
  try {
    testCase.run();
    passedIds.push(testCase.id);
  } catch (error) {
    failed.push({
      id: testCase.id,
      title: testCase.title,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const failedIds = failed.map((item) => item.id);
console.log(`parite L2 Web — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_L2_WEB_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: L2 Finance Web");
