import { describe, expect, it } from "vitest";
import type { StudentFee } from "../types";
import { buildParentFinanceModel } from "./parentFinance";

const child = {
  id: "stu-a",
  matricule: "ELE-A",
  name: "Enfant A",
};

function fee(overrides: Partial<StudentFee> = {}): StudentFee {
  return {
    id: "fee-a",
    studentId: "stu-a",
    schoolCode: "SCH-1",
    className: "6e A",
    schoolFeeItemId: "item-1",
    feeGridId: "grid-1",
    feeType: "Scolarité",
    label: "Scolarité T1",
    currency: "EUR",
    academicYear: "2026-2027",
    initialAmount: 100,
    discount: 0,
    exemption: 10,
    amountDue: 100,
    amountPaid: 40,
    balance: 50,
    status: "Partiellement payé",
    ...overrides,
  };
}

describe("parentFinance — scope enfant et vérité canonique", () => {
  it("exclut intégralement les données d'un autre enfant", () => {
    const model = buildParentFinanceModel({
      student: child,
      studentFees: [
        fee(),
        fee({
          id: "fee-b",
          studentId: "stu-b",
          amountDue: 900,
          amountPaid: 900,
          balance: 0,
          exemption: 0,
          status: "Payé",
        }),
      ],
      payments: [
        {
          id: "pay-a",
          studentId: "stu-a",
          amount: 40,
          allocatedAmount: 40,
          unallocatedAmount: 0,
          currency: "EUR",
          status: "Payé",
          date: "2026-09-20",
        },
        {
          id: "pay-b",
          studentId: "stu-b",
          amount: 900,
          allocatedAmount: 900,
          unallocatedAmount: 0,
          currency: "EUR",
          status: "Payé",
          date: "2026-09-21",
        },
      ],
    });

    expect(model.fees.map((row) => row.id)).toEqual(["fee-a"]);
    expect(model.payments.map((row) => row.id)).toEqual(["pay-a"]);
    expect(model.expectedLabel).toContain("90");
    expect(model.allocatedLabel).toContain("40");
    expect(model.remainingLabel).toContain("50");
    expect(model.collectedLabel).toContain("40");
  });

  it("ignore les obligations annulées dans les montants et préserve l'historique paiement", () => {
    const model = buildParentFinanceModel({
      student: child,
      studentFees: [
        fee(),
        fee({
          id: "fee-cancelled",
          amountDue: 500,
          amountPaid: 500,
          balance: 0,
          exemption: 0,
          status: "Annulé",
        }),
      ],
      payments: [
        {
          id: "pay-new",
          studentId: "stu-a",
          amount: 25,
          allocatedAmount: 25,
          unallocatedAmount: 0,
          currency: "EUR",
          status: "Payé",
          date: "2026-09-22",
        },
        {
          id: "pay-old",
          studentId: "stu-a",
          amount: 15,
          allocatedAmount: 15,
          unallocatedAmount: 0,
          currency: "EUR",
          status: "Annulé",
          date: "2026-09-01",
        },
      ],
    });

    expect(model.expectedLabel).toContain("90");
    expect(model.remainingLabel).toContain("50");
    expect(model.collectedLabel).toContain("25");
    expect(model.payments.map((row) => row.id)).toEqual(["pay-new", "pay-old"]);
  });

  it("fail-closed sans enfant sélectionné", () => {
    const model = buildParentFinanceModel({
      student: null,
      studentFees: [fee()],
      payments: [{ id: "pay-a", studentId: "stu-a", amount: 40, status: "Payé" }],
    });

    expect(model.fees).toEqual([]);
    expect(model.payments).toEqual([]);
    expect(model.expectedLabel).toBe("—");
    expect(model.collectedLabel).toBe("—");
  });
});
