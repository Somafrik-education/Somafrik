/**
 * FIN-L3-04 — ventilation cash Paiements, jamais catalogCurrency.
 *   npx tsx Mobile/src/lib/paymentCashBreakdown.test.ts
 */
import assert from "node:assert/strict";
import { normalizePaymentRow } from "./dataTruth";
import { formatPaymentCashAmounts, getPaymentCashBreakdown } from "./paymentCashKpi";

const UNKNOWN = "Devise non renseignée";

function run() {
  const mixed = [
    normalizePaymentRow({
      id: "p-cdf",
      amount: 100_000,
      allocatedAmount: 100_000,
      unallocatedAmount: 0,
      currency: "CDF",
      status: "Payé",
    }),
    normalizePaymentRow({
      id: "p-usd",
      amount: 50,
      allocatedAmount: 50,
      unallocatedAmount: 0,
      currency: "USD",
      status: "Payé",
    }),
  ];
  const buckets = getPaymentCashBreakdown(mixed);
  const cdf = buckets.find((row) => row.currencyKey === "CDF");
  const usd = buckets.find((row) => row.currencyKey === "USD");
  assert.equal(cdf?.collectedAmount, 100_000, "FIN-L3-04-A CDF");
  assert.equal(usd?.collectedAmount, 50, "FIN-L3-04-A USD");
  assert.equal(
    buckets.some((row) => row.collectedAmount === 100_050),
    false,
    "FIN-L3-04-A jamais 100050",
  );
  const formatted = formatPaymentCashAmounts(mixed);
  assert.equal(/100[\s\u00a0\u202f]?050/.test(formatted.collectedLabel), false);
  assert.match(formatted.collectedLabel, /100[\s\u00a0\u202f]?000 CDF/);
  assert.match(formatted.collectedLabel, /50 USD/);

  const unknown = getPaymentCashBreakdown([
    normalizePaymentRow({ id: "p-empty", amount: 80, currency: "", status: "Payé" }),
    normalizePaymentRow({ id: "p-spaces", amount: 20, currency: "   ", status: "Payé" }),
    normalizePaymentRow({ id: "p-null", amount: 10, status: "Payé" }),
  ]);
  assert.equal(unknown.length, 1, "FIN-L3-04-B un seau inconnu");
  assert.equal(unknown[0]?.currencyKey, "");
  assert.equal(unknown[0]?.currencyLabel, UNKNOWN);
  assert.equal(unknown[0]?.collectedAmount, 110);

  const leftover = getPaymentCashBreakdown([
    normalizePaymentRow({
      id: "p-unalloc",
      amount: 150,
      allocatedAmount: 0,
      unallocatedAmount: 150,
      currency: "CDF",
      status: "Non imputé",
    }),
  ]);
  assert.equal(leftover[0]?.collectedAmount, 150, "FIN-L3-04-D encaissé");
  assert.equal(leftover[0]?.allocatedAmount, 0, "FIN-L3-04-D pas imputé");
  assert.equal(leftover[0]?.unallocatedAmount, 150);

  const missingUnallocated = {
    amount: 100,
    allocatedAmount: 60,
    currency: "CDF",
    status: "Payé",
  };
  const inferred = getPaymentCashBreakdown([missingUnallocated]);
  assert.equal(inferred[0]?.collectedAmount, 100, "FIN-L3-04-E encaissé conservé");
  assert.equal(inferred[0]?.allocatedAmount, 60, "FIN-L3-04-E imputé conservé");
  assert.notEqual(inferred[0]?.unallocatedAmount, 40, "FIN-L3-04-E ne fabrique pas collected-allocated");
  assert.equal(inferred[0]?.unallocatedAmount, null, "FIN-L3-04-E fail-closed, pas un 0 masquant");
  assert.equal(formatPaymentCashAmounts([missingUnallocated]).unallocatedLabel, "—");

  const viaNormalize = getPaymentCashBreakdown([
    normalizePaymentRow({ id: "p-e", ...missingUnallocated }),
  ]);
  assert.notEqual(viaNormalize[0]?.unallocatedAmount, 40, "FIN-L3-04-E normalizePaymentRow ne fabrique pas 40");
  assert.equal(viaNormalize[0]?.unallocatedAmount, null);
}

run();
console.log("PASS Mobile FIN-L3-04 paymentCashBreakdown");
