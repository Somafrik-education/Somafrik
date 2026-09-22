import { describe, expect, it } from "vitest";
import { formatPaymentCashAmounts, getPaymentCashBreakdown, isCountedCashPayment } from "./paymentCashKpi";

describe("FIN-L3-05-B3 même fixture ledger => collected par devise", () => {
  it("Payé CDF + brouillon 200 + Payé USD", () => {
    const rows = [
      { amount: 754_250, currency: "CDF", status: "Payé", allocatedAmount: 754_250, unallocatedAmount: 0 },
      { amount: 200, currency: "CDF", status: "Brouillon", allocatedAmount: 0, unallocatedAmount: 200 },
      { amount: 50, currency: "USD", status: "Payé", allocatedAmount: 50, unallocatedAmount: 0 },
    ];
    expect(isCountedCashPayment(rows[1]!)).toBe(false);
    const buckets = getPaymentCashBreakdown(rows);
    expect(buckets.find((row) => row.currencyKey === "CDF")?.collectedAmount).toBe(754_250);
    expect(buckets.find((row) => row.currencyKey === "USD")?.collectedAmount).toBe(50);
    const label = formatPaymentCashAmounts(rows).collectedLabel;
    expect(label).not.toMatch(/754[\s\u00a0\u202f]?450/);
    expect(label).not.toMatch(/754[\s\u00a0\u202f]?300/);
  });
});
