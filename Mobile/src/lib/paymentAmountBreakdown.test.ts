/**
 * FIN-L3-01 — ventilation Paiements Mobile, même contrat que le Web.
 *   npx tsx Mobile/src/lib/paymentAmountBreakdown.test.ts
 */
import assert from "node:assert/strict";
import { getPaymentRateKpi, type StudentFeeObligation } from "./paymentRateKpi";
import {
  countActiveStudentFeeObligations,
  formatPaymentOverviewAmounts,
  getPaymentAmountBreakdown,
} from "./paymentAmountBreakdown";

const UNKNOWN = "Devise non renseignée";

function obligation(
  studentId: string,
  extras: Partial<StudentFeeObligation> = {},
): StudentFeeObligation {
  return {
    studentId,
    amountDue: 1000,
    amountPaid: 0,
    exemption: 0,
    status: "À payer",
    ...extras,
  };
}

function mixedCdfUsd(): StudentFeeObligation[] {
  return [
    obligation("s-cdf", { amountDue: 100_000, amountPaid: 20_000, currency: "CDF" }),
    obligation("s-usd", { amountDue: 50, amountPaid: 10, currency: "USD" }),
  ];
}

function run() {
  const kpi = getPaymentRateKpi(mixedCdfUsd());
  assert.equal(kpi.rate, null, "le taux reste fail-closed en multidevise");
  assert.equal(kpi.expectedAmount, 0);

  const formatted = formatPaymentOverviewAmounts(mixedCdfUsd());
  assert.equal(
    /0[\s\u00a0\u202f]?USD/.test(formatted.expectedLabel),
    false,
    "FIN-L3-01-A expectedLabel ne doit pas être 0 USD",
  );
  assert.equal(/0[\s\u00a0\u202f]?USD/.test(formatted.collectedLabel), false);
  assert.equal(/0[\s\u00a0\u202f]?USD/.test(formatted.remainingLabel), false);

  const buckets = getPaymentAmountBreakdown(mixedCdfUsd());
  const cdf = buckets.find((row) => row.currencyKey === "CDF");
  const usd = buckets.find((row) => row.currencyKey === "USD");
  assert.equal(cdf?.expectedAmount, 100_000, "FIN-L3-01-B CDF attendu");
  assert.equal(cdf?.collectedAmount, 20_000);
  assert.equal(cdf?.remainingAmount, 80_000);
  assert.equal(usd?.expectedAmount, 50, "FIN-L3-01-B USD attendu");
  assert.equal(usd?.collectedAmount, 10);
  assert.equal(usd?.remainingAmount, 40);
  assert.match(formatted.expectedLabel, /100[\s\u00a0\u202f]?000 CDF/);
  assert.match(formatted.expectedLabel, /50 USD/);

  const cdfMissing = getPaymentAmountBreakdown([
    obligation("s-cdf", { amountDue: 100_000, amountPaid: 0, currency: "CDF" }),
    obligation("s-miss", { amountDue: 50, amountPaid: 0 }),
  ]);
  assert.equal(
    cdfMissing.find((row) => row.currencyKey === "CDF")?.expectedAmount,
    100_000,
    "FIN-L3-01-C pas de regroupement dans CDF",
  );
  assert.equal(cdfMissing.find((row) => row.currencyKey === "")?.expectedAmount, 50);
  assert.equal(cdfMissing.find((row) => row.currencyKey === "")?.currencyLabel, UNKNOWN);

  const usdMissing = getPaymentAmountBreakdown([
    obligation("s-usd", { amountDue: 50, amountPaid: 10, currency: "USD" }),
    obligation("s-miss", { amountDue: 80, amountPaid: 0 }),
  ]);
  assert.equal(
    usdMissing.find((row) => row.currencyKey === "USD")?.expectedAmount,
    50,
    "FIN-L3-01-D pas de regroupement dans USD",
  );
  assert.equal(usdMissing.find((row) => row.currencyKey === "")?.expectedAmount, 80);

  const unknown = getPaymentAmountBreakdown([
    obligation("s-empty", { amountDue: 10, amountPaid: 0, currency: "" }),
    obligation("s-spaces", { amountDue: 20, amountPaid: 0, currency: "   " }),
    obligation("s-null", { amountDue: 30, amountPaid: 0, currency: null }),
  ]);
  assert.equal(unknown.length, 1, "FIN-L3-01-E un seul seau inconnu");
  assert.equal(unknown[0]?.currencyKey, "");
  assert.equal(unknown[0]?.currencyLabel, UNKNOWN);
  assert.equal(unknown[0]?.expectedAmount, 60);
  const unknownFees = [
    obligation("s-empty", { amountDue: 10, amountPaid: 0, currency: "" }),
    obligation("s-spaces", { amountDue: 20, amountPaid: 0, currency: "   " }),
    obligation("s-null", { amountDue: 30, amountPaid: 0, currency: null }),
  ];
  assert.match(formatPaymentOverviewAmounts(unknownFees).expectedLabel, /Devise non renseignée/);

  const active = Array.from({ length: 41 }, (_, index) =>
    obligation(`s-${index}`, { currency: index % 2 === 0 ? "CDF" : "USD" }),
  );
  assert.equal(countActiveStudentFeeObligations(active), 41);
}

run();
console.log("PASS Mobile FIN-L3-01 paymentAmountBreakdown");
