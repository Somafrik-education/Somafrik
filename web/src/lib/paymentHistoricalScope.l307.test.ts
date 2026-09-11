import { describe, expect, it } from "vitest";
import type { BackOfficeState, SessionUser } from "../types";
import { scopedPayments } from "./establishment";
import { formatPaymentCashAmounts } from "./paymentCashKpi";

/**
 * FIN-L3-07 — régression préprod observée :
 * - GET /payments renvoie 30 lignes / 754 450 CDF encaissés ;
 * - le Web n'en gardait que 26 / 754 250 CDF ;
 * - les 4 lignes perdues appartiennent à un élève absent du snapshot students,
 *   mais portent le login_code canonique de l'établissement.
 */
describe("FIN-L3-07 — paiements historiques et scope établissement canonique", () => {
  it("conserve les paiements historiques du même login_code même si l'élève n'est plus dans students", () => {
    const user = {
      id: "USR-COMPTABLE",
      identifier: "comptable",
      role: "Comptable",
      schoolId: "school-uuid-nuru",
      // leftover historique de session : ne doit pas décider du tenant Finance.
      schoolCode: "CD-2026-0001",
      // login_code V2 canonique présent dans GET /payments.
      schoolPublicCode: "CD-IN-26-001",
    } as SessionUser;

    const payments = [
      {
        id: "PAY-CURRENT",
        studentId: "STU-ACTIVE",
        schoolCode: "CD-IN-26-001",
        amount: 754_250,
        totalAmount: 754_250,
        currency: "CDF",
        status: "Payé",
      },
      {
        id: "PAY-ESTHER-1",
        studentId: "CD-IN-OE-26-00001",
        schoolCode: "CD-IN-26-001",
        amount: 500,
        totalAmount: 500,
        currency: "CDF",
        status: "Annulé",
      },
      {
        id: "PAY-ESTHER-2",
        studentId: "CD-IN-OE-26-00001",
        schoolCode: "CD-IN-26-001",
        amount: 1,
        totalAmount: 1,
        currency: "CDF",
        status: "Annulé",
      },
      {
        id: "PAY-ESTHER-3",
        studentId: "CD-IN-OE-26-00001",
        schoolCode: "CD-IN-26-001",
        amount: 40,
        totalAmount: 40,
        currency: "CDF",
        status: "Annulé",
      },
      {
        id: "PAY-ESTHER-4",
        studentId: "CD-IN-OE-26-00001",
        schoolCode: "CD-IN-26-001",
        amount: 200,
        totalAmount: 200,
        currency: "CDF",
        status: "Trop-perçu",
      },
      {
        id: "PAY-FOREIGN",
        studentId: "STU-FOREIGN",
        schoolCode: "CD-OTHER-26-999",
        amount: 999_999,
        totalAmount: 999_999,
        currency: "CDF",
        status: "Payé",
      },
    ];

    const state = {
      students: [
        {
          id: "STU-ACTIVE",
          schoolId: "school-uuid-nuru",
          schoolCode: "CD-IN-26-001",
          schoolPublicCode: "CD-IN-26-001",
        },
      ],
      payments,
    } as unknown as BackOfficeState;

    const scoped = scopedPayments(user, state);
    expect(scoped.map((row) => row.id)).toEqual([
      "PAY-CURRENT",
      "PAY-ESTHER-1",
      "PAY-ESTHER-2",
      "PAY-ESTHER-3",
      "PAY-ESTHER-4",
    ]);
    expect(scoped.some((row) => row.id === "PAY-FOREIGN")).toBe(false);

    const cash = formatPaymentCashAmounts(scoped);
    expect(cash.buckets.find((row) => row.currencyKey === "CDF")?.collectedAmount).toBe(754_450);
  });

  it("conserve un paiement SCH-001 si le schoolCode de session n'est pas un leftover CC-YYYY-NNNN", () => {
    const user = {
      id: "u-admin",
      identifier: "admin",
      role: "Admin School",
      schoolCode: "SCH-001",
    } as SessionUser;
    const state = {
      students: [{ id: "stu-1", schoolCode: "SCH-001" }],
      payments: [
        { id: "SCH-001-2026-PAY-0001", studentId: "stu-1", schoolCode: "SCH-001", amount: 50_000, status: "Payé" },
        { id: "SCH-999-2026-PAY-0001", studentId: "stu-foreign", schoolCode: "SCH-999", amount: 1, status: "Payé" },
      ],
    } as unknown as BackOfficeState;
    const scoped = scopedPayments(user, state);
    expect(scoped.map((row) => row.id)).toEqual(["SCH-001-2026-PAY-0001"]);
  });
});
