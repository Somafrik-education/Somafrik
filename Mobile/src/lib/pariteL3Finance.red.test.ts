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
