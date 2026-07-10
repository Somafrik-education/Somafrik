import { describe, it, expect } from "vitest";

import {
  computeFeeBalance,
  detectDuplicatePayment,
  generatePaymentReference,
  validateQuickPaymentInput,
  type QuickPaymentInput,
} from "../src/lib/quickPayment";

const student = {
  id: "STU-1",
  name: "Marie Kabila",
  matricule: "ELE-2026-0001",
  className: "6A",
  schoolCode: "SCH1",
  schoolName: "École 1",
  parentPhone: "+243820111111",
  parentEmail: "parent@test.app",
};

describe("payments", () => {
  it("valide un paiement correct", () => {
    const input: QuickPaymentInput = {
      student,
      feeType: "Inscription",
      amount: 50_000,
      method: "Espèces",
      date: "10-07-2026",
    };
    expect(validateQuickPaymentInput(input)).toBeNull();
  });

  it("rejette un montant vide ou négatif", () => {
    expect(validateQuickPaymentInput({ student, feeType: "Inscription", amount: 0, method: "Espèces", date: "10-07-2026" })).toMatch(/montant/i);
    expect(validateQuickPaymentInput({ student, feeType: "Inscription", amount: -100, method: "Espèces", date: "10-07-2026" })).toMatch(/montant/i);
  });

  it("rejette un élève manquant", () => {
    expect(validateQuickPaymentInput({ feeType: "Inscription", amount: 1000, method: "Espèces", date: "10-07-2026" })).toMatch(/élève/i);
  });

  it("calcule le reste à payer correctement", () => {
    const balance = computeFeeBalance("STU-1", "Inscription", [], "CDF");
    expect(balance.amountDue).toBe(50_000);
    expect(balance.remaining).toBe(50_000);
  });

  it("met à jour le solde après paiement", () => {
    const payments = [
      { studentId: "STU-1", feeType: "Inscription", amount: 20_000, status: "Payé", date: "10-07-2026" },
    ];
    const balance = computeFeeBalance("STU-1", "Inscription", payments, "CDF");
    expect(balance.amountPaid).toBe(20_000);
    expect(balance.remaining).toBe(30_000);
  });

  it("génère une référence paiement au format attendu", () => {
    const year = new Date().getFullYear();
    expect(generatePaymentReference("SCH1", [])).toBe(`SCH1-${year}-PAY-0001`);
    expect(
      generatePaymentReference("SCH1", [{ reference: `SCH1-${year}-PAY-0003` }]),
    ).toBe(`SCH1-${year}-PAY-0004`);
  });

  it("détecte un paiement en doublon", () => {
    const input: QuickPaymentInput = {
      student,
      feeType: "Inscription",
      amount: 50_000,
      method: "Espèces",
      date: "10-07-2026",
    };
    const payments = [
      { studentId: "STU-1", feeType: "Inscription", amount: 50_000, method: "Espèces", date: "10-07-2026", status: "Payé" },
    ];
    expect(detectDuplicatePayment(input, payments).duplicate).toBe(true);
  });
});
