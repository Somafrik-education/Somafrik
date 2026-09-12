/**
 * FIN-L3-06 — montant encaissé canonique (API amount, jamais SUM(items)).
 *   npx tsx Mobile/src/lib/paymentCanonicalAmount.l306.test.ts
 */
import assert from "node:assert/strict";
import { normalizePaymentRow } from "./dataTruth";
import {
  formatPaymentCashAmounts as formatMobileCash,
  getPaymentCashBreakdown,
  isCountedMobileCashPayment,
} from "./paymentCashKpi";
import { formatPaymentCashAmounts as formatWebCash } from "../../../web/src/lib/paymentCashKpi";
import {
  FIN_L306_DIVERGENT_COUNTED,
  FIN_L306_DIVERGENT_COUNTED_ID,
  FIN_L306_DRAFT_200,
  FIN_L306_LEDGER,
  FIN_L306_USD_COUNTED,
  auditPaymentAmountVsItems,
  mobileItemsCountedAmount,
  sumPaymentItems,
  webCountedAmount,
} from "./finL306CanonicalCash.fixture";

function run() {
  const audit = auditPaymentAmountVsItems(FIN_L306_LEDGER);
  assert.equal(audit.length, 1, "une seule ligne amount ≠ SUM(items) dans la fixture");
  assert.equal(audit[0]?.id, FIN_L306_DIVERGENT_COUNTED_ID);
  assert.equal(audit[0]?.amount, 754_250);
  assert.equal(audit[0]?.totalAmount, 754_250);
  assert.equal(audit[0]?.sumItems, 754_450);
  assert.equal(audit[0]?.difference, 200);
  assert.equal(audit[0]?.countedWeb, true);
  assert.equal(audit[0]?.countedMobile, true);
  assert.equal(webCountedAmount(FIN_L306_LEDGER, "CDF"), 754_250, "Σ Web counted amount");
  assert.equal(mobileItemsCountedAmount(FIN_L306_LEDGER, "CDF"), 754_450, "Σ Mobile SUM(items)");
  assert.equal(
    mobileItemsCountedAmount(FIN_L306_LEDGER, "CDF") - webCountedAmount(FIN_L306_LEDGER, "CDF"),
    200,
    "écart exact +200 CDF",
  );

  const b1 = normalizePaymentRow({
    amount: 1000,
    totalAmount: 1000,
    items: [{ amount: 800 }, { amount: 400 }],
    status: "Payé",
  });
  assert.equal(b1.amount, 1000, "FIN-L3-06-B1 amount canonique serveur");
  assert.notEqual(b1.amount, 1200, "FIN-L3-06-B1 interdit SUM(items)=1200");
  assert.equal(b1.totalAmount, 1000, "FIN-L3-06-B1 totalAmount reste canonique");
  const b1Items = b1.items ?? [];
  assert.equal(b1Items.length, 2, "FIN-L3-06-B1 items conservés pour le reçu");
  assert.equal(
    b1Items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    1200,
    "FIN-L3-06-B1 SUM(items) reste 1200 sur les lignes",
  );

  const b2Rows = FIN_L306_LEDGER.map((row) => normalizePaymentRow(row));
  const b2 = formatMobileCash(b2Rows);
  const b2Cdf = b2.buckets.find((row) => row.currencyKey === "CDF");
  assert.equal(b2Cdf?.collectedAmount, 754_250, "FIN-L3-06-B2 cash Mobile = 754250 CDF");
  assert.notEqual(b2Cdf?.collectedAmount, 754_450, "FIN-L3-06-B2 interdit 754450 CDF");
  assert.equal(/754[\s\u00a0\u202f]?450/.test(b2.collectedLabel), false);

  const webLabels = formatWebCash(FIN_L306_LEDGER);
  const mobileLabels = formatMobileCash(b2Rows);
  assert.equal(
    mobileLabels.collectedLabel,
    webLabels.collectedLabel,
    "FIN-L3-06-B3 formatPaymentCashAmounts Web === Mobile",
  );
  for (const currency of ["CDF", "USD"]) {
    const webBucket = webLabels.buckets.find((row) => row.currencyKey === currency);
    const mobileBucket = mobileLabels.buckets.find((row) => row.currencyKey === currency);
    assert.equal(
      mobileBucket?.collectedAmount,
      webBucket?.collectedAmount,
      `FIN-L3-06-B3 collected ${currency}`,
    );
  }

  assert.equal(isCountedMobileCashPayment(normalizePaymentRow(FIN_L306_DRAFT_200)), false, "FIN-L3-06-B4");
  assert.equal(b2Cdf?.collectedAmount, 754_250, "FIN-L3-06-B4 brouillon 200 CDF toujours exclu");

  for (const status of ["Annulé", "Pending", "Refusé", "Échoué", "Brouillon", "En attente de confirmation", "failed"]) {
    const row = normalizePaymentRow({
      ...FIN_L306_DIVERGENT_COUNTED,
      id: `skip-${status}`,
      status,
    });
    assert.equal(isCountedMobileCashPayment(row), false, `FIN-L3-06-B5 ${status}`);
    assert.equal(getPaymentCashBreakdown([row])[0]?.collectedAmount ?? 0, 0, `FIN-L3-06-B5 ${status} encaissé`);
  }

  const mixed = formatMobileCash([
    normalizePaymentRow(FIN_L306_DIVERGENT_COUNTED),
    normalizePaymentRow(FIN_L306_USD_COUNTED),
  ]);
  assert.equal(mixed.buckets.find((row) => row.currencyKey === "CDF")?.collectedAmount, 754_250, "FIN-L3-06-B6 CDF");
  assert.equal(mixed.buckets.find((row) => row.currencyKey === "USD")?.collectedAmount, 50, "FIN-L3-06-B6 USD");
  assert.equal(
    mixed.buckets.some((row) => row.collectedAmount === 754_300),
    false,
    "FIN-L3-06-B6 jamais somme cross-currency",
  );
  assert.equal(/754[\s\u00a0\u202f]?300/.test(mixed.collectedLabel), false);

  const missingAmount = normalizePaymentRow({
    items: [{ amount: 500 }],
    status: "Payé",
    currency: "CDF",
  });
  assert.equal(missingAmount.amount, 0, "FIN-L3-06-B7 fail-closed si amount/totalAmount absents");
  assert.notEqual(missingAmount.amount, 500, "FIN-L3-06-B7 interdit SUM(items) silencieux");
  assert.equal(sumPaymentItems({ items: missingAmount.items }), 500, "FIN-L3-06-B7 items conservés");

  const viaTotalAmount = normalizePaymentRow({
    totalAmount: 1000,
    items: [{ amount: 800 }, { amount: 400 }],
    status: "Payé",
  });
  assert.equal(
    viaTotalAmount.amount,
    1000,
    "FIN-L3-06-B7 totalAmount est le fallback canonique GET /payments (même colonne persistée)",
  );
  assert.notEqual(viaTotalAmount.amount, 1200);

  const decoratedApiPayload = normalizePaymentRow({
    amount: 754_450,
    totalAmount: 754_450,
    currency: "CDF",
    status: "Payé",
    allocatedAmount: 754_450,
    unallocatedAmount: 0,
    items: [{ amount: 754_250 }, { amount: 200 }],
  });
  assert.equal(
    decoratedApiPayload.amount,
    754_450,
    "FIN-L3-06-C si GET a déjà SUM(items), le client GREEN ne ramène pas 754250",
  );
  const decoratedCash = formatMobileCash([decoratedApiPayload]);
  assert.equal(decoratedCash.buckets.find((row) => row.currencyKey === "CDF")?.collectedAmount, 754_450);
  assert.equal(formatWebCash([decoratedApiPayload]).buckets.find((row) => row.currencyKey === "CDF")?.collectedAmount, 754_450);
}

run();
console.log("PASS Mobile FIN-L3-06 paymentCanonicalAmount");
