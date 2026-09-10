/**
 * Lot Finance L2 — écarts causaux Mobile + non-régression Oscar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPaymentRateKpi, type StudentFeeObligation } from "./paymentRateKpi";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "FIN-L2-05",
    title: "Taux de paiement Mobile fail-closed si CDF et USD coexistent",
    run() {
      const kpi = getPaymentRateKpi([
        {
          studentId: "s1",
          amountDue: 100_000,
          amountPaid: 20_000,
          exemption: 0,
          status: "À payer",
          currency: "CDF",
        } as StudentFeeObligation & { currency: string },
        {
          studentId: "s2",
          amountDue: 50,
          amountPaid: 10,
          exemption: 0,
          status: "À payer",
          currency: "USD",
        } as StudentFeeObligation & { currency: string },
      ]);
      assert.equal(kpi.rate, null, "un taux unique ne peut pas mélanger CDF et USD");
      assert.equal(kpi.value, "—");
      assert.equal(kpi.expectedAmount, 0);
    },
  },
  {
    id: "FIN-L2-07",
    title: "Taux de paiement Mobile : devise absente ou vide, pas de pourcentage",
    run() {
      const missing = getPaymentRateKpi([
        {
          studentId: "s1",
          amountDue: 100_000,
          amountPaid: 20_000,
          exemption: 0,
          status: "À payer",
          currency: "CDF",
        },
        {
          studentId: "s2",
          amountDue: 50,
          amountPaid: 10,
          exemption: 0,
          status: "À payer",
        },
      ]);
      assert.equal(missing.rate, null, "CDF + devise absente ne doit pas produire un taux");
      assert.equal(missing.value, "—");
      assert.equal(missing.expectedAmount, 0);

      const blank = getPaymentRateKpi([
        {
          studentId: "s1",
          amountDue: 100_000,
          amountPaid: 20_000,
          exemption: 0,
          status: "À payer",
          currency: "USD",
        },
        {
          studentId: "s2",
          amountDue: 50,
          amountPaid: 10,
          exemption: 0,
          status: "À payer",
          currency: "",
        },
      ]);
      assert.equal(blank.rate, null, "USD + devise vide ne doit pas produire un taux");
      assert.equal(blank.value, "—");
    },
  },
  {
    id: "FIN-L2-03-M",
    title: "Oscar Mobile : Impayés conserve Montant alloué aux impayés ouverts",
    run() {
      const unpaidScreen = read("screens/UnpaidScreen.tsx");
      assert.match(unpaidScreen, /Montant alloué aux impayés ouverts/);
      assert.doesNotMatch(unpaidScreen, />Montant payé</);
      assert.match(unpaidScreen, /Montant attendu/);
      assert.match(unpaidScreen, /Reste dû/);
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
console.log(`parite L2 Mobile — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_L2_MOBILE_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: L2 Finance Mobile");
