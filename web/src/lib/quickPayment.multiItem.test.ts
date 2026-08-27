import { describe, expect, it } from "vitest";
import {
  createPaymentLine,
  parseLineAmount,
  paymentItemsDetailLabel,
  sumPaymentLines,
  validateMultiItemPaymentInput,
} from "./quickPayment";

describe("paiement multi-libellés", () => {
  it("somme les lignes pour le total affiché", () => {
    expect(
      sumPaymentLines([
        { amount: "500" },
        { amount: "1" },
        { amount: "40" },
      ]),
    ).toBe(541);
  });

  it("refuse un libellé à montant nul", () => {
    expect(
      validateMultiItemPaymentInput({
        student: { id: "stu-1", classId: "class-6a" } as never,
        classId: "class-6a",
        classOptions: [{ classId: "class-6a" }],
        method: "Espèces",
        date: "2026-08-19",
        lines: [createPaymentLine("Scolarité")],
      }),
    ).toMatch(/montant/);
  });

  it("refuse un élève sans inscription active", () => {
    expect(
      validateMultiItemPaymentInput({
        student: { id: "stu-1" } as never,
        classId: "",
        classOptions: [],
        method: "Espèces",
        date: "2026-08-19",
        lines: [{ ...createPaymentLine("Scolarité"), amount: "500" }],
      }),
    ).toMatch(/inscription active/);
  });

  it("détail vide ne force pas 1 libellé", () => {
    expect(paymentItemsDetailLabel([])).toBe("");
    expect(paymentItemsDetailLabel(undefined)).toBe("");
  });

  it("détail 3 libellés", () => {
    expect(
      paymentItemsDetailLabel([
        { feeLabel: "Minerval", amount: 500 },
        { feeLabel: "Examen", amount: 1 },
        { feeLabel: "Cantine", amount: 40 },
      ]),
    ).toBe("3 libellés");
  });

  it("parse virgule décimale", () => {
    expect(parseLineAmount("40,5")).toBe(40.5);
  });
});
