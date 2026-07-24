import { describe, expect, it, vi } from "vitest";
import type { BackOfficeState, SessionUser } from "../../types";
import {
  buildPaymentCancelPlan,
  buildPaymentCreatePersistPlan,
  buildPaymentReceiptPrintPlan,
  PAYMENT_CANCEL_ALREADY_MESSAGE,
  PAYMENT_CANCEL_OUT_OF_SCOPE_MESSAGE,
  PAYMENT_CANCEL_REASON_REQUIRED_MESSAGE,
  PAYMENT_CANCEL_SUCCESS_MESSAGE,
  PAYMENT_CREATE_OUT_OF_SCOPE_MESSAGE,
} from "./paymentWorkflow";

const admin: SessionUser = {
  id: "u-admin",
  role: "Admin School",
  schoolCode: "SCH-001",
  identifier: "admin",
  firstName: "Admin",
  lastName: "School",
} as unknown as SessionUser;

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: "SCH-001-2026-PAY-0001",
    publicId: "SCH-001-2026-PAY-0001",
    reference: "SCH-001-2026-PAY-0001",
    schoolCode: "SCH-001",
    studentId: "stu-1",
    studentName: "Moussa Ba",
    feeType: "Minerval / scolarité",
    amount: 50_000,
    currency: "CDF",
    method: "Espèces",
    date: "2026-07-01",
    status: "Payé",
    verificationCode: "VF-TEST",
    ...overrides,
  };
}

function baseState(overrides: Partial<BackOfficeState> = {}): BackOfficeState {
  return {
    schools: [{ code: "SCH-001", name: "École" }],
    students: [{ id: "stu-1", name: "Ba", firstName: "Moussa", schoolCode: "SCH-001" }],
    payments: [
      payment(),
      payment({
        id: "SCH-999-2026-PAY-0001",
        reference: "SCH-999-2026-PAY-0001",
        schoolCode: "SCH-999",
        studentId: "stu-foreign",
      }),
    ],
    notifications: [],
    auditLog: [],
    ...overrides,
  } as unknown as BackOfficeState;
}

describe("paymentWorkflow (D2.8d4)", () => {
  it("cancel refuse motif vide / espaces", () => {
    const showToast = vi.fn();
    const state = baseState();
    const plan = buildPaymentCancelPlan(
      { scopeUser: admin, state, showToast },
      { payment: payment(), reason: "   " },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(PAYMENT_CANCEL_REASON_REQUIRED_MESSAGE, "error");
  });

  it("cancel refuse paiement déjà annulé", () => {
    const showToast = vi.fn();
    const plan = buildPaymentCancelPlan(
      { scopeUser: admin, state: baseState(), showToast },
      { payment: payment({ status: "Annulé" }), reason: "Erreur" },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(PAYMENT_CANCEL_ALREADY_MESSAGE, "error");
  });

  it("cancel refuse hors périmètre", () => {
    const showToast = vi.fn();
    const plan = buildPaymentCancelPlan(
      { scopeUser: admin, state: baseState(), showToast },
      {
        payment: payment({
          id: "SCH-999-2026-PAY-0001",
          schoolCode: "SCH-999",
          studentId: "stu-foreign",
        }),
        reason: "Erreur",
      },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(PAYMENT_CANCEL_OUT_OF_SCOPE_MESSAGE, "error");
  });

  it("cancel happy path : soft-cancel + audit + immutabilité montant/réf + pas de mutation source", () => {
    const state = baseState();
    const source = payment();
    const snapshotPayments = structuredClone(state.payments);
    const snapshotSource = structuredClone(source);
    const plan = buildPaymentCancelPlan(
      { scopeUser: admin, state, showToast: vi.fn() },
      { payment: source, reason: "  Double encaissement  " },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.successMessage).toBe(PAYMENT_CANCEL_SUCCESS_MESSAGE);
    expect(plan.cancelled.status).toBe("Annulé");
    expect(plan.cancelled.cancellationReason).toBe("Double encaissement");
    expect(plan.cancelled.amount).toBe(50_000);
    expect(plan.cancelled.reference).toBe(source.reference);
    expect(plan.cancelled.verificationCode).toBe(source.verificationCode);
    expect(plan.cancelled.studentId).toBe(source.studentId);
    expect(source).toEqual(snapshotSource);
    expect(state.payments).toEqual(snapshotPayments);

    const audit = (plan.patch.auditLog as Array<{ action: string; details?: string }>)[0];
    expect(audit.action).toBe("payment.cancel");
    expect(audit.details).toBe("Double encaissement");
  });

  it("receipt print : audit seul, aucune mutation payments", () => {
    const state = baseState();
    const snapshot = structuredClone(state.payments);
    const plan = buildPaymentReceiptPrintPlan(
      { scopeUser: admin, state },
      { payment: payment() },
    );
    expect(plan.patch.payments).toBeUndefined();
    expect((plan.patch.auditLog as Array<{ action: string }>)[0]?.action).toBe(
      "payment.receipt.print",
    );
    expect(state.payments).toEqual(snapshot);
  });

  it("create persist refuse modification d’un paiement hors périmètre", () => {
    const showToast = vi.fn();
    // Merge refuse l’update d’un id existant hors scope (pas une création libre).
    const plan = buildPaymentCreatePersistPlan(
      { scopeUser: admin, state: baseState(), showToast },
      {
        payment: payment({
          id: "SCH-999-2026-PAY-0001",
          reference: "SCH-999-2026-PAY-0001",
          schoolCode: "SCH-999",
          studentId: "stu-foreign",
          amount: 1,
        }),
      },
    );
    expect(plan.ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith(PAYMENT_CREATE_OUT_OF_SCOPE_MESSAGE, "error");
  });

  it("create persist : patch payments + audit create + notification parent + immutabilité source", () => {
    const state = baseState();
    const snapshot = structuredClone(state.payments);
    const newPayment = payment({
      id: "SCH-001-2026-PAY-0002",
      reference: "SCH-001-2026-PAY-0002",
      amount: 10_000,
      overpaymentAmount: 0,
    });
    const plan = buildPaymentCreatePersistPlan(
      { scopeUser: admin, state, showToast: vi.fn() },
      {
        payment: newPayment,
        student: {
          id: "stu-1",
          name: "Moussa Ba",
          schoolCode: "SCH-001",
          className: "6ème A",
          matricule: "",
          schoolName: "École",
          parentPhone: "",
          parentEmail: "",
        },
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.successMessage).toContain("SCH-001-2026-PAY-0002");
    expect((plan.patch.payments as unknown[]).length).toBe(3);
    expect((plan.patch.auditLog as Array<{ action: string }>)[0]?.action).toBe("payment.create");
    expect((plan.patch.notifications as unknown[]).length).toBe(1);
    expect(state.payments).toEqual(snapshot);
    expect(newPayment.amount).toBe(10_000);
  });
});
