import { describe, expect, it } from "vitest";
import { formatPaymentOverviewAmounts } from "./paymentAmountBreakdown";
import type { StudentFeeObligation } from "./paymentRateKpi";

const UNKNOWN = "Devise non renseignée";

function fee(extras: Partial<StudentFeeObligation> & { balance?: number }): StudentFeeObligation {
  return {
    studentId: extras.studentId ?? "s-1",
    amountDue: extras.amountDue ?? 0,
    amountPaid: extras.amountPaid ?? 0,
    exemption: extras.exemption ?? 0,
    status: extras.status ?? "À payer",
    currency: extras.currency ?? "CDF",
    ...extras,
  };
}

function preprodFees(): StudentFeeObligation[] {
  return [
    fee({
      studentId: "s-cdf",
      currency: "CDF",
      amountDue: 1_840_500,
      amountPaid: 750_499,
    }),
    fee({
      studentId: "s-usd",
      currency: "USD",
      amountDue: 3_100,
      amountPaid: 2_100,
    }),
  ];
}

describe("FIN-L3-05-D — Frais & tarifs Reste à payer par devise", () => {
  it("FIN-L3-05-D1 CDF + USD => deux valeurs indépendantes, jamais 1 091 001 CDF", () => {
    const fees = preprodFees();
    const remaining = formatPaymentOverviewAmounts(fees).remainingLabel;
    expect(remaining).toMatch(/1[\s\u00a0\u202f]?090[\s\u00a0\u202f]?001 CDF/);
    expect(remaining).toMatch(/1[\s\u00a0\u202f]?000 USD/);
    expect(remaining).not.toMatch(/1[\s\u00a0\u202f]?091[\s\u00a0\u202f]?001/);
    const crossCurrencyTrap = fees.reduce(
      (sum, row) => sum + Math.max(0, Number(row.amountDue) - Number(row.amountPaid) - Number(row.exemption ?? 0)),
      0,
    );
    expect(crossCurrencyTrap).toBe(1_091_001);
  });

  it("FIN-L3-05-D2 absence devise => Devise non renseignée", () => {
    const fees = [
      fee({ studentId: "s-cdf", currency: "CDF", amountDue: 1_090_001, amountPaid: 0 }),
      fee({ studentId: "s-unk", currency: "   ", amountDue: 50, amountPaid: 0 }),
    ];
    const remaining = formatPaymentOverviewAmounts(fees).remainingLabel;
    expect(remaining).toContain("CDF");
    expect(remaining).toContain(UNKNOWN);
    expect(remaining).not.toMatch(/1[\s\u00a0\u202f]?090[\s\u00a0\u202f]?051/);
  });

  it("FIN-L3-05-D3 même dataset : reste Frais === reste Paiements par devise", () => {
    const fees = preprodFees();
    const paymentsRemaining = formatPaymentOverviewAmounts(fees).remainingLabel;
    expect(paymentsRemaining).toMatch(/1[\s\u00a0\u202f]?090[\s\u00a0\u202f]?001 CDF/);
    expect(paymentsRemaining).toMatch(/1[\s\u00a0\u202f]?000 USD/);
  });

  it("FIN-L3-05-D4 aucune conversion FX implicite", () => {
    const fees = preprodFees();
    const buckets = formatPaymentOverviewAmounts(fees).buckets;
    expect(buckets.find((row) => row.currencyKey === "CDF")?.remainingAmount).toBe(1_090_001);
    expect(buckets.find((row) => row.currencyKey === "USD")?.remainingAmount).toBe(1_000);
    expect(buckets.some((row) => row.remainingAmount === 1_091_001)).toBe(false);
  });
});
