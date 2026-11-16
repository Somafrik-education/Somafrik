import { describe, expect, it } from "vitest";
import {
  canAddPaymentObligationLine,
  createPaymentLine,
  parseLineAmount,
  paymentItemsDetailLabel,
  paymentLineExceedsBalance,
  PAYMENT_DUPLICATE_OBLIGATION_ERROR,
  PAYMENT_LINE_AMOUNT_ERROR,
  PAYMENT_LINE_EXCEEDS_BALANCE_ERROR,
  soleUnusedObligationId,
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
        lines: [{ ...createPaymentLine("__unallocated__"), amount: "500" }],
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

  const base = {
    student: { id: "stu-1", classId: "class-6a" } as never,
    classId: "class-6a",
    classOptions: [{ classId: "class-6a" }],
    method: "Espèces",
    date: "2026-08-19",
    openObligations: [
      { obligationId: "obl-min", balance: 1_000 },
      { obligationId: "obl-exam", balance: 10 },
      { obligationId: "obl-can", balance: 100 },
    ],
  };

  it("accepte un paiement partiel sur plusieurs obligations", () => {
    expect(
      validateMultiItemPaymentInput({
        ...base,
        lines: [
          { ...createPaymentLine("obl-min"), amount: "500" },
          { ...createPaymentLine("obl-exam"), amount: "1" },
          { ...createPaymentLine("obl-can"), amount: "40" },
        ],
      }),
    ).toBeNull();
  });

  it("refuse un montant négatif, nul ou supérieur au solde de la ligne", () => {
    expect(
      validateMultiItemPaymentInput({
        ...base,
        lines: [{ ...createPaymentLine("obl-min"), amount: "-1" }],
      }),
    ).toBe(PAYMENT_LINE_AMOUNT_ERROR);
    expect(
      validateMultiItemPaymentInput({
        ...base,
        lines: [{ ...createPaymentLine("obl-min"), amount: "0" }],
      }),
    ).toBe(PAYMENT_LINE_AMOUNT_ERROR);
    expect(
      validateMultiItemPaymentInput({
        ...base,
        lines: [{ ...createPaymentLine("obl-min"), amount: "1001" }],
      }),
    ).toBe(PAYMENT_LINE_EXCEEDS_BALANCE_ERROR);
    expect(paymentLineExceedsBalance({ obligationId: "obl-min", amount: "1001" }, base.openObligations)).toBe(true);
    expect(paymentLineExceedsBalance({ obligationId: "obl-min", amount: "1000" }, base.openObligations)).toBe(false);
  });

  it("refuse la même obligation sur deux lignes", () => {
    expect(
      validateMultiItemPaymentInput({
        ...base,
        lines: [
          { ...createPaymentLine("obl-min"), amount: "100" },
          { ...createPaymentLine("obl-min"), amount: "100" },
        ],
      }),
    ).toBe(PAYMENT_DUPLICATE_OBLIGATION_ERROR);
  });

  it("limite l'ajout au nombre d'obligations ouvertes et préremplit la dernière", () => {
    expect(canAddPaymentObligationLine(1, 0)).toBe(true);
    expect(canAddPaymentObligationLine(1, 3)).toBe(true);
    expect(canAddPaymentObligationLine(3, 3)).toBe(false);
    expect(soleUnusedObligationId([{ obligationId: "obl-min" }, { obligationId: "obl-exam" }], base.openObligations)).toBe(
      "obl-can",
    );
    expect(soleUnusedObligationId([{ obligationId: "" }], base.openObligations)).toBe("");
  });
});
