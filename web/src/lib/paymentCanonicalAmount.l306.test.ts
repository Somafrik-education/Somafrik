import { describe, expect, it } from "vitest";
import { formatPaymentCashAmounts, getPaymentCashBreakdown, isCountedCashPayment } from "./paymentCashKpi";
import {
  FIN_L306_DIVERGENT_COUNTED,
  FIN_L306_DRAFT_200,
  FIN_L306_LEDGER,
  FIN_L306_USD_COUNTED,
  auditPaymentAmountVsItems,
  mobileItemsCountedAmount,
  webCountedAmount,
} from "../../../Mobile/src/lib/finL306CanonicalCash.fixture";

describe("FIN-L3-06 — cash Web = amount canonique GET /payments", () => {
  it("FIN-L3-06-A fixture hypothétique pre-décoration : 754250 vs SUM(items) 754450", () => {
    const audit = auditPaymentAmountVsItems(FIN_L306_LEDGER);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.amount).toBe(754_250);
    expect(audit[0]?.totalAmount).toBe(754_250);
    expect(audit[0]?.sumItems).toBe(754_450);
    expect(audit[0]?.difference).toBe(200);
    expect(webCountedAmount(FIN_L306_LEDGER, "CDF")).toBe(754_250);
    expect(mobileItemsCountedAmount(FIN_L306_LEDGER, "CDF")).toBe(754_450);
  });

  it("FIN-L3-06-C payload déjà décoré amount=754450 : Web et Mobile restent à 754450", () => {
    const decorated = {
      amount: 754_450,
      totalAmount: 754_450,
      currency: "CDF",
      status: "Payé",
      allocatedAmount: 754_450,
      unallocatedAmount: 0,
      items: [
        { feeType: "Minerval", amount: 754_250 },
        { feeType: "Ligne", amount: 200 },
      ],
    };
    const cdf = getPaymentCashBreakdown([decorated]).find((row) => row.currencyKey === "CDF");
    expect(cdf?.collectedAmount).toBe(754_450);
    expect(formatPaymentCashAmounts([decorated]).collectedLabel).toMatch(/754[\s\u00a0\u202f]?450 CDF/);
  });

  it("FIN-L3-06-B2 Web utilise 754250 même si SUM(items)=754450 sur fixture pre-décoration", () => {
    const cdf = getPaymentCashBreakdown(FIN_L306_LEDGER).find((row) => row.currencyKey === "CDF");
    expect(cdf?.collectedAmount).toBe(754_250);
    expect(cdf?.collectedAmount).not.toBe(754_450);
    expect(formatPaymentCashAmounts(FIN_L306_LEDGER).collectedLabel).not.toMatch(/754[\s\u00a0\u202f]?450/);
  });

  it("FIN-L3-06-B3 Web formatPaymentCashAmounts par devise", () => {
    const formatted = formatPaymentCashAmounts(FIN_L306_LEDGER);
    expect(formatted.collectedLabel).toMatch(/754[\s\u00a0\u202f]?250 CDF/);
    expect(formatted.collectedLabel).toMatch(/50 USD/);
    expect(formatted.buckets.find((row) => row.currencyKey === "CDF")?.collectedAmount).toBe(754_250);
    expect(formatted.buckets.find((row) => row.currencyKey === "USD")?.collectedAmount).toBe(50);
  });

  it("FIN-L3-06-B4 brouillon 200 CDF exclu", () => {
    expect(isCountedCashPayment(FIN_L306_DRAFT_200)).toBe(false);
    const cdf = getPaymentCashBreakdown([FIN_L306_DIVERGENT_COUNTED, FIN_L306_DRAFT_200]).find(
      (row) => row.currencyKey === "CDF",
    );
    expect(cdf?.collectedAmount).toBe(754_250);
  });

  it("FIN-L3-06-B5 statuts exclus", () => {
    for (const status of ["Annulé", "Pending", "Refusé", "Échoué", "Brouillon", "failed"]) {
      expect(isCountedCashPayment({ status }), status).toBe(false);
    }
  });

  it("FIN-L3-06-B6 jamais somme CDF+USD", () => {
    const formatted = formatPaymentCashAmounts([FIN_L306_DIVERGENT_COUNTED, FIN_L306_USD_COUNTED]);
    expect(formatted.collectedLabel).not.toMatch(/754[\s\u00a0\u202f]?300/);
    expect(formatted.collectedLabel).toMatch(/754[\s\u00a0\u202f]?250 CDF/);
    expect(formatted.collectedLabel).toMatch(/50 USD/);
  });
});
