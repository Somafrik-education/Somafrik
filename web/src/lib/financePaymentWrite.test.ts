import { describe, expect, it } from "vitest";
import {
  UNALLOCATED_TARGET,
  assertNoFeeTypeOnlyImputation,
  buildFinancePaymentItems,
  buildFinancePaymentWritePayload,
  collectOpenObligationsFromProjection,
  draftLineCash,
  isOpenObligationFromProjection,
  isPendingPaymentStatus,
  presentPaymentCashFromProjection,
} from "./financePaymentWrite";

describe("F5 contrat d'écriture Web", () => {
  it("n'impute jamais par feeType seul", () => {
    expect(() => assertNoFeeTypeOnlyImputation([{ feeType: "Scolarité", amount: 100 }])).toThrow(
      /FINANCE_OBLIGATION_ID_REQUIRED/,
    );
    expect(() => buildFinancePaymentItems([{ feeType: "Scolarité", amount: 10_000 }])).toThrow(
      /FINANCE_OBLIGATION_ID_REQUIRED/,
    );
    expect(() =>
      buildFinancePaymentWritePayload({
        studentId: "stu-1",
        classId: "class-1",
        paymentMethod: "Espèces",
        paidAt: "2026-09-05",
        lines: [{ feeType: "Scolarité", amount: 10_000 }],
      }),
    ).toThrow(/FINANCE_OBLIGATION_ID_REQUIRED/);
  });

  it("refuse __unallocated__ : aucun paiement libre", () => {
    expect(() => buildFinancePaymentItems([{ obligationId: UNALLOCATED_TARGET, amount: 100 }])).toThrow(
      /FINANCE_UNALLOCATED_FORBIDDEN/,
    );
    expect(buildFinancePaymentItems([{ obligationId: "obl-1", amount: 40, feeType: "Scolarité" }])).toEqual([
      { obligationId: "obl-1", amount: 40, feeType: "Scolarité", feeLabel: "Scolarité" },
    ]);
    expect(() => buildFinancePaymentItems([{ obligationId: undefined, feeType: "Scolarité", amount: 10_000 }])).toThrow(
      /FINANCE_OBLIGATION_ID_REQUIRED/,
    );
    expect(() => buildFinancePaymentItems([{ obligationId: "", feeType: "Scolarité", amount: 10_000 }])).toThrow(
      /FINANCE_OBLIGATION_ID_REQUIRED/,
    );
    expect(() => buildFinancePaymentItems([{ obligationId: "   ", feeType: "Scolarité", amount: 10_000 }])).toThrow(
      /FINANCE_OBLIGATION_ID_REQUIRED/,
    );
  });

  it("aligne Web et Mobile sur des obligations ouvertes", () => {
    expect(() =>
      buildFinancePaymentWritePayload({
        studentId: "stu-1",
        classId: "class-1",
        paymentMethod: "Espèces",
        paidAt: "2026-09-05",
        lines: [
          { obligationId: "obl-insc", amount: 10_000, feeType: "Inscription" },
          { obligationId: UNALLOCATED_TARGET, amount: 2_000 },
        ],
      }),
    ).toThrow(/FINANCE_UNALLOCATED_FORBIDDEN/);
    const payload = buildFinancePaymentWritePayload({
      studentId: "stu-1",
      classId: "class-1",
      paymentMethod: "Espèces",
      paidAt: "2026-09-05",
      lines: [
        { obligationId: "obl-insc", amount: 10_000, feeType: "Inscription" },
        { obligationId: "obl-sco", amount: 15_000, feeType: "Scolarité" },
      ],
    });
    expect(payload.items).toEqual([
      { obligationId: "obl-insc", amount: 10_000, feeType: "Inscription", feeLabel: "Inscription" },
      { obligationId: "obl-sco", amount: 15_000, feeType: "Scolarité", feeLabel: "Scolarité" },
    ]);
    expect(payload.method).toBe("Espèces");
    expect(payload.paymentMethod).toBe("Espèces");
  });

  it("lit le solde serveur, jamais due - paid", () => {
    expect(
      isOpenObligationFromProjection({
        id: "obl-1",
        studentId: "stu-1",
        amountDue: 100,
        amountPaid: 0,
        status: "À payer",
      }),
    ).toBe(false);
    expect(
      isOpenObligationFromProjection({
        id: "obl-1",
        studentId: "stu-1",
        balance: 60,
        status: "Partiellement payé",
      }),
    ).toBe(true);
    const open = collectOpenObligationsFromProjection("stu-1", [
      { id: "obl-1", studentId: "stu-1", balance: 60, status: "Partiellement payé", label: "Scolarité" },
      { id: "obl-2", studentId: "stu-1", amountDue: 100, amountPaid: 0, status: "À payer" },
    ]);
    expect(open.map((row) => row.obligationId)).toEqual(["obl-1"]);
  });

  it("présente encaisse / imputé / non imputé depuis la projection", () => {
    expect(
      presentPaymentCashFromProjection({ amount: 30_000, allocatedAmount: 28_000, unallocatedAmount: 2_000 }),
    ).toEqual({ received: 30_000, allocated: 28_000, unallocated: 2_000 });
    expect(draftLineCash([
      { obligationId: "obl-1", amount: "10000" },
      { obligationId: UNALLOCATED_TARGET, amount: "2000" },
    ])).toEqual({ received: 12_000, allocated: 10_000, unallocated: 2_000 });
    expect(isPendingPaymentStatus("En attente de confirmation")).toBe(true);
  });
});
