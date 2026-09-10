import { describe, expect, it } from "vitest";
import { formatFinanceAmount } from "./financeCurrency";
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

describe("FIN-L3-01 — KPI Paiements par devise (pas de 0 USD artificiel)", () => {
  it("FIN-L3-01-A CDF + USD → aucun « 0 USD » artificiel", () => {
    const fees = mixedCdfUsd();
    const kpi = getPaymentRateKpi(fees);
    expect(kpi.rate).toBeNull();
    expect(kpi.expectedAmount).toBe(0);

    const formatted = formatPaymentOverviewAmounts(fees);
    expect(formatted.expectedLabel).not.toMatch(/(^|\n)0[\s\u00a0\u202f]+USD(\n|$)/);
    expect(formatted.collectedLabel).not.toMatch(/(^|\n)0[\s\u00a0\u202f]+USD(\n|$)/);
    expect(formatted.remainingLabel).not.toMatch(/(^|\n)0[\s\u00a0\u202f]+USD(\n|$)/);
    expect(formatted.expectedLabel).not.toBe(formatFinanceAmount(0, "USD"));
  });

  it("FIN-L3-01-B CDF + USD → attendu / encaissé / reste séparés par devise", () => {
    const buckets = getPaymentAmountBreakdown(mixedCdfUsd());
    const byKey = Object.fromEntries(buckets.map((row) => [row.currencyKey, row]));
    expect(byKey.CDF).toEqual(
      expect.objectContaining({
        currencyLabel: "CDF",
        expectedAmount: 100_000,
        collectedAmount: 20_000,
        remainingAmount: 80_000,
      }),
    );
    expect(byKey.USD).toEqual(
      expect.objectContaining({
        currencyLabel: "USD",
        expectedAmount: 50,
        collectedAmount: 10,
        remainingAmount: 40,
      }),
    );
    const formatted = formatPaymentOverviewAmounts(mixedCdfUsd());
    expect(formatted.expectedLabel).toMatch(/100[\s\u00a0\u202f]?000 CDF/);
    expect(formatted.expectedLabel).toMatch(/50 USD/);
    expect(formatted.collectedLabel).toMatch(/20[\s\u00a0\u202f]?000 CDF/);
    expect(formatted.collectedLabel).toMatch(/10 USD/);
    expect(formatted.remainingLabel).toMatch(/80[\s\u00a0\u202f]?000 CDF/);
    expect(formatted.remainingLabel).toMatch(/40 USD/);
  });

  it("FIN-L3-01-C CDF + devise absente → aucun regroupement dans CDF", () => {
    const fees = [
      obligation("s-cdf", { amountDue: 100_000, amountPaid: 0, currency: "CDF" }),
      obligation("s-miss", { amountDue: 50, amountPaid: 0 }),
    ];
    const buckets = getPaymentAmountBreakdown(fees);
    const cdf = buckets.find((row) => row.currencyKey === "CDF");
    const unknown = buckets.find((row) => row.currencyKey === "");
    expect(cdf?.expectedAmount).toBe(100_000);
    expect(unknown?.expectedAmount).toBe(50);
    expect(unknown?.currencyLabel).toBe(UNKNOWN);
    expect(buckets).toHaveLength(2);
  });

  it("FIN-L3-01-D USD + devise absente → aucun regroupement dans USD", () => {
    const fees = [
      obligation("s-usd", { amountDue: 50, amountPaid: 10, currency: "USD" }),
      obligation("s-miss", { amountDue: 80, amountPaid: 0 }),
    ];
    const buckets = getPaymentAmountBreakdown(fees);
    const usd = buckets.find((row) => row.currencyKey === "USD");
    const unknown = buckets.find((row) => row.currencyKey === "");
    expect(usd?.expectedAmount).toBe(50);
    expect(unknown?.expectedAmount).toBe(80);
    expect(unknown?.currencyLabel).toBe(UNKNOWN);
  });

  it("FIN-L3-01-E currency \"\", espaces ou null → devise inconnue / fail-closed", () => {
    const fees = [
      obligation("s-empty", { amountDue: 10, amountPaid: 0, currency: "" }),
      obligation("s-spaces", { amountDue: 20, amountPaid: 0, currency: "   " }),
      obligation("s-null", { amountDue: 30, amountPaid: 0, currency: null }),
    ];
    const buckets = getPaymentAmountBreakdown(fees);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.currencyKey).toBe("");
    expect(buckets[0]?.currencyLabel).toBe(UNKNOWN);
    expect(buckets[0]?.expectedAmount).toBe(60);
    const formatted = formatPaymentOverviewAmounts(fees);
    expect(formatted.expectedLabel).toContain(UNKNOWN);
    expect(formatted.expectedLabel).not.toMatch(/CDF/);
    expect(formatted.expectedLabel).not.toMatch(/USD/);
  });

  it("n'additionne jamais CDF + USD dans un seul montant", () => {
    const buckets = getPaymentAmountBreakdown(mixedCdfUsd());
    const mixedSum = buckets.reduce((sum, row) => sum + row.expectedAmount, 0);
    expect(mixedSum).toBe(100_050);
    expect(buckets.some((row) => row.expectedAmount === 100_050)).toBe(false);
  });
});

describe("FIN-L3-02 — compteur obligations élèves", () => {
  it("exclut annulé / archivé et conserve 41 obligations in-scope (≠ 19 lignes tarifaires)", () => {
    const active = Array.from({ length: 41 }, (_, index) =>
      obligation(`s-${index}`, { currency: index % 2 === 0 ? "CDF" : "USD" }),
    );
    const ignored = [
      obligation("cancelled", { status: "Annulé", currency: "CDF" }),
      obligation("archived", { archivedAt: "2026-09-01T00:00:00.000Z", currency: "USD" }),
    ];
    expect(countActiveStudentFeeObligations([...active, ...ignored])).toBe(41);
    expect(countActiveStudentFeeObligations(active.slice(0, 19))).toBe(19);
  });
});
