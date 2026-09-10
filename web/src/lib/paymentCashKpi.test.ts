import { describe, expect, it } from "vitest";
import { formatPaymentCashAmounts, getPaymentCashBreakdown, isCountedCashPayment } from "./paymentCashKpi";

const UNKNOWN = "Devise non renseignée";

function payment(
  extras: {
    amount?: number;
    allocatedAmount?: number;
    unallocatedAmount?: number;
    currency?: string | null;
    status?: string;
  } = {},
) {
  return {
    amount: 0,
    allocatedAmount: 0,
    unallocatedAmount: 0,
    status: "Payé",
    ...extras,
  };
}

describe("FIN-L3-04 — cash Paiements par devise", () => {
  it("FIN-L3-04-A cash 100000 CDF + 50 USD => jamais 100050 CDF/USD", () => {
    const rows = [
      payment({ amount: 100_000, allocatedAmount: 100_000, currency: "CDF" }),
      payment({ amount: 50, allocatedAmount: 50, currency: "USD" }),
    ];
    const buckets = getPaymentCashBreakdown(rows);
    const byKey = Object.fromEntries(buckets.map((row) => [row.currencyKey, row]));
    expect(byKey.CDF?.collectedAmount).toBe(100_000);
    expect(byKey.USD?.collectedAmount).toBe(50);
    expect(buckets.some((row) => row.collectedAmount === 100_050)).toBe(false);
    const formatted = formatPaymentCashAmounts(rows);
    expect(formatted.collectedLabel).not.toMatch(/100[\s\u00a0\u202f]?050/);
    expect(formatted.collectedLabel).toMatch(/100[\s\u00a0\u202f]?000 CDF/);
    expect(formatted.collectedLabel).toMatch(/50 USD/);
  });

  it("FIN-L3-04-B devise paiement absente => Devise non renseignée", () => {
    const rows = [
      payment({ amount: 80, allocatedAmount: 80, currency: "" }),
      payment({ amount: 20, allocatedAmount: 20, currency: "   " }),
      payment({ amount: 10, allocatedAmount: 10, currency: null }),
    ];
    const buckets = getPaymentCashBreakdown(rows);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.currencyKey).toBe("");
    expect(buckets[0]?.currencyLabel).toBe(UNKNOWN);
    expect(buckets[0]?.collectedAmount).toBe(110);
    expect(formatPaymentCashAmounts(rows).collectedLabel).toContain(UNKNOWN);
    expect(formatPaymentCashAmounts(rows).collectedLabel).not.toMatch(/CDF|USD/);
  });

  it("FIN-L3-04-D paiement non imputé est encaissé mais pas imputé", () => {
    const rows = [
      payment({
        amount: 150,
        allocatedAmount: 0,
        unallocatedAmount: 150,
        currency: "CDF",
        status: "Non imputé",
      }),
    ];
    const cdf = getPaymentCashBreakdown(rows).find((row) => row.currencyKey === "CDF");
    expect(cdf?.collectedAmount).toBe(150);
    expect(cdf?.allocatedAmount).toBe(0);
    expect(cdf?.unallocatedAmount).toBe(150);
  });

  it("FIN-L3-04-E unallocatedAmount absent => ne fabrique pas 40 et ne masque pas par 0", () => {
    const rows = [
      {
        amount: 100,
        allocatedAmount: 60,
        currency: "CDF",
        status: "Payé",
      },
    ];
    const cdf = getPaymentCashBreakdown(rows).find((row) => row.currencyKey === "CDF");
    expect(cdf?.collectedAmount).toBe(100);
    expect(cdf?.allocatedAmount).toBe(60);
    expect(cdf?.unallocatedAmount).not.toBe(40);
    expect(cdf?.unallocatedAmount).toBeNull();
    const formatted = formatPaymentCashAmounts(rows);
    expect(formatted.unallocatedLabel).toBe("—");
    expect(formatted.collectedLabel).toMatch(/100 CDF/);
  });
});

describe("FIN-L3-05-B — encaissé Web, statuts comptabilisés", () => {
  it("FIN-L3-05-B1 table de décision des statuts", () => {
    const table: Array<[string, boolean]> = [
      ["Payé", true],
      ["Non imputé", true],
      ["Partiel", true],
      ["Brouillon", false],
      ["En attente", false],
      ["pending", false],
      ["Annulé", false],
      ["Refusé", false],
      ["Échoué", false],
      ["failed", false],
    ];
    for (const [status, counted] of table) {
      expect(isCountedCashPayment({ status }), status).toBe(counted);
    }
  });

  it("FIN-L3-05-B2 brouillon 200 CDF exclu de l'encaissé", () => {
    const rows = [
      payment({ amount: 754_250, allocatedAmount: 754_250, unallocatedAmount: 0, currency: "CDF", status: "Payé" }),
      payment({ amount: 200, allocatedAmount: 0, unallocatedAmount: 200, currency: "CDF", status: "Brouillon" }),
    ];
    const cdf = getPaymentCashBreakdown(rows).find((row) => row.currencyKey === "CDF");
    expect(cdf?.collectedAmount).toBe(754_250);
    expect(cdf?.collectedAmount).not.toBe(754_450);
  });

  it("FIN-L3-05-B4 CDF + USD jamais sommé", () => {
    const rows = [
      payment({ amount: 754_250, currency: "CDF", status: "Payé" }),
      payment({ amount: 50, currency: "USD", status: "Payé" }),
    ];
    const formatted = formatPaymentCashAmounts(rows);
    expect(formatted.collectedLabel).not.toMatch(/754[\s\u00a0\u202f]?300/);
    expect(formatted.collectedLabel).toMatch(/754[\s\u00a0\u202f]?250 CDF/);
    expect(formatted.collectedLabel).toMatch(/50 USD/);
  });
});
