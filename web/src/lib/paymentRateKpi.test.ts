import { describe, expect, it } from "vitest";
import {
  PAYMENT_RATE_KPI_LABEL,
  formatPaymentRateKpi,
  getPaymentRateKpi,
  type StudentFeeObligation,
} from "./paymentRateKpi";

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

describe("Taux de paiement (assiette obligations, pas payments.length)", () => {
  it("libellé = Taux de paiement", () => {
    expect(PAYMENT_RATE_KPI_LABEL).toBe("Taux de paiement");
  });

  it("5 élèves attendus, 1 payé → 20 %", () => {
    const fees = [
      obligation("s1", { amountPaid: 1000, status: "Payé" }),
      obligation("s2"),
      obligation("s3"),
      obligation("s4"),
      obligation("s5"),
    ];
    expect(formatPaymentRateKpi(fees).label).toBe("Taux de paiement");
    expect(formatPaymentRateKpi(fees).value).toBe("20 %");
    expect(getPaymentRateKpi(fees).rate).toBe(20);
  });

  it("5 attendus, 0 payé → 0 %", () => {
    const fees = ["s1", "s2", "s3", "s4", "s5"].map((id) => obligation(id));
    expect(formatPaymentRateKpi(fees).value).toBe("0 %");
    expect(getPaymentRateKpi(fees).rate).toBe(0);
  });

  it("5 attendus, 5 payés → 100 %", () => {
    const fees = ["s1", "s2", "s3", "s4", "s5"].map((id) =>
      obligation(id, { amountPaid: 1000, status: "Payé" }),
    );
    expect(formatPaymentRateKpi(fees).value).toBe("100 %");
  });

  it("aucune assiette attendue → —", () => {
    expect(formatPaymentRateKpi([]).value).toBe("—");
    expect(getPaymentRateKpi([]).rate).toBeNull();
    const cancelled = ["s1", "s2"].map((id) => obligation(id, { status: "Annulé" }));
    expect(formatPaymentRateKpi(cancelled).value).toBe("—");
  });

  it("une seule obligation soldée n'invente pas 100 % s'il reste des dettes", () => {
    const five = [
      obligation("s1", { amountPaid: 1000, status: "Payé" }),
      obligation("s2"),
      obligation("s3"),
      obligation("s4"),
      obligation("s5"),
    ];
    expect(formatPaymentRateKpi(five).value).not.toBe("100 %");
  });

  it("montants dus différents → encaissé / attendu", () => {
    const fees = [
      obligation("s1", { amountDue: 4000, amountPaid: 4000, status: "Payé" }),
      obligation("s2", { amountDue: 1000, amountPaid: 0 }),
    ];
    expect(formatPaymentRateKpi(fees).value).toBe("80 %");
  });
});
