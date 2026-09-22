import { describe, expect, it } from "vitest";
import type { SessionUser, StudentFee } from "../types";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import { buildFinancePaymentsOverview } from "./paymentAmountBreakdown";
import { scopedStudentFees } from "./fees";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-2026-0001";

function schoolAdmin(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "admin-cd-2026-0001",
    firstName: "Admin",
    lastName: "Nuru",
    role: SCHOOL_ADMIN_ROLE,
    schoolCode: "JWT-LEFTOVER",
    schoolPublicCode: LOGIN_A,
    schoolId: SCHOOL_ID_A,
    identifier: "admin-nuru",
    ...overrides,
  } as SessionUser;
}

function fee(overrides: Partial<StudentFee> = {}): StudentFee {
  return {
    id: "STUFEE-1",
    studentId: "student-1",
    studentName: "Ada",
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    className: "6ème A",
    schoolFeeItemId: "ITEM-1",
    feeGridId: "GRID-1",
    feeType: "Minerval",
    label: "Minerval",
    currency: "CDF",
    academicYear: "2026-2027",
    initialAmount: 100_000,
    discount: 0,
    exemption: 0,
    amountDue: 100_000,
    amountPaid: 0,
    balance: 100_000,
    status: "À payer",
    ...overrides,
  };
}

describe("FIN-L3-02 — compteur Paiements scopé établissement", () => {
  it("school_admin CD-2026-0001 ne compte pas les obligations d'un autre tenant", () => {
    const user = schoolAdmin();
    const state = {
      studentFees: [
        fee({ id: "in-scope", studentId: "s-a" }),
        fee({
          id: "foreign",
          studentId: "s-b",
          schoolId: SCHOOL_ID_B,
          schoolCode: LOGIN_A,
          currency: "USD",
          amountDue: 50,
          amountPaid: 0,
          balance: 50,
        }),
      ],
    } as never;

    expect(scopedStudentFees(user, state)).toHaveLength(1);
    const overview = buildFinancePaymentsOverview({
      user,
      state,
      recentPaymentCount: 0,
    });
    expect(overview.obligationCount).toBe(1);
    expect(overview.buckets).toHaveLength(1);
    expect(overview.buckets[0]?.currencyKey).toBe("CDF");
  });

  it("41 obligations élèves in-scope de CD-2026-0001 restent 41, pas 19", () => {
    const user = schoolAdmin();
    const studentFees = Array.from({ length: 41 }, (_, index) =>
      fee({
        id: `STUFEE-${index}`,
        studentId: `student-${index}`,
        currency: index < 30 ? "CDF" : "USD",
      }),
    );
    const overview = buildFinancePaymentsOverview({
      user,
      state: { studentFees } as never,
      recentPaymentCount: 3,
    });
    expect(overview.obligationCount).toBe(41);
    expect(overview.obligationCount).not.toBe(19);
  });
});
