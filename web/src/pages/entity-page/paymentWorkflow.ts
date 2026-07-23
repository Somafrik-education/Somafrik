/**
 * D2.8d4 — Workflow Paiements (lot isolé, vigilance financière).
 *
 * Plans purs / quasi purs : annulation, impression reçu, persistance création.
 * Aucun hook ni contexte React. JSX modales reste hors module.
 *
 * Hors lot : Contacts, Relations, Affectations, domaine lib/quickPayment.
 */
import { appendAuditLog } from "../../lib/audit";
import {
  buildParentPaymentNotification,
  buildPaymentAuditEntry,
  cancelPaymentRecord,
  isPaymentCancelled,
  type PaymentRecord,
  type StudentSearchResult,
} from "../../lib/quickPayment";
import type { BackOfficeState, SessionUser } from "../../types";
import { mergeEntityIntoState } from "./entityCrudCore";

export type ToastFn = (
  message: string,
  tone?: "info" | "success" | "error" | "warning",
) => void;

export type PaymentWorkflowDeps = {
  scopeUser: SessionUser | null;
  state: BackOfficeState;
  showToast: ToastFn;
};

export const PAYMENT_CANCEL_SUCCESS_MESSAGE = "Paiement annulé" as const;
export const PAYMENT_CANCEL_REASON_REQUIRED_MESSAGE =
  "Le motif d'annulation est obligatoire" as const;
export const PAYMENT_CANCEL_OUT_OF_SCOPE_MESSAGE =
  "Annulation refusée : paiement hors périmètre de l'établissement." as const;
export const PAYMENT_CANCEL_ALREADY_MESSAGE =
  "Ce paiement est déjà annulé." as const;
export const PAYMENT_CREATE_OUT_OF_SCOPE_MESSAGE =
  "Paiement refusé : élève hors périmètre de l'établissement." as const;

export type PaymentCancelPlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<BackOfficeState>;
      successMessage: typeof PAYMENT_CANCEL_SUCCESS_MESSAGE;
      cancelled: PaymentRecord;
    };

/**
 * Soft-cancel : conserve l'historique, n'altère pas montant / référence.
 * Immutabilité source : ne mute pas `payment` ni `state.payments`.
 */
export function buildPaymentCancelPlan(
  deps: PaymentWorkflowDeps,
  input: { payment: PaymentRecord; reason: string },
): PaymentCancelPlan {
  const { scopeUser, state, showToast } = deps;
  const reason = String(input.reason ?? "").trim();
  if (!reason) {
    showToast(PAYMENT_CANCEL_REASON_REQUIRED_MESSAGE, "error");
    return { ok: false };
  }
  if (isPaymentCancelled(input.payment)) {
    showToast(PAYMENT_CANCEL_ALREADY_MESSAGE, "error");
    return { ok: false };
  }

  const cancelled = cancelPaymentRecord(input.payment, reason, scopeUser);
  const mergeResult = mergeEntityIntoState("payments", scopeUser, state, cancelled);
  if (!mergeResult.applied) {
    showToast(PAYMENT_CANCEL_OUT_OF_SCOPE_MESSAGE, "error");
    return { ok: false };
  }

  return {
    ok: true,
    cancelled,
    successMessage: PAYMENT_CANCEL_SUCCESS_MESSAGE,
    patch: {
      payments: mergeResult.rows as BackOfficeState["payments"],
      auditLog: appendAuditLog(
        state.auditLog,
        buildPaymentAuditEntry(cancelled, scopeUser, "payment.cancel", reason),
      ),
    },
  };
}

export type PaymentReceiptPrintPlan = {
  patch: Partial<BackOfficeState>;
};

/** Audit-only : aucune mutation des lignes de paiement. */
export function buildPaymentReceiptPrintPlan(
  deps: Pick<PaymentWorkflowDeps, "scopeUser" | "state">,
  input: { payment: PaymentRecord },
): PaymentReceiptPrintPlan {
  return {
    patch: {
      auditLog: appendAuditLog(
        deps.state.auditLog,
        buildPaymentAuditEntry(input.payment, deps.scopeUser, "payment.receipt.print"),
      ),
    },
  };
}

export type PaymentCreatePersistPlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<BackOfficeState>;
      successMessage: string;
      payment: PaymentRecord;
    };

/**
 * Persistance d'un paiement déjà construit (après validations / confirms UI).
 */
export function buildPaymentCreatePersistPlan(
  deps: PaymentWorkflowDeps,
  input: {
    payment: PaymentRecord;
    student?: StudentSearchResult | null;
  },
): PaymentCreatePersistPlan {
  const { scopeUser, state, showToast } = deps;
  const mergeResult = mergeEntityIntoState("payments", scopeUser, state, input.payment);
  if (!mergeResult.applied) {
    showToast(PAYMENT_CREATE_OUT_OF_SCOPE_MESSAGE, "error");
    return { ok: false };
  }

  const notification =
    input.student != null
      ? buildParentPaymentNotification(input.payment, input.student)
      : null;

  return {
    ok: true,
    payment: input.payment,
    successMessage: `Paiement enregistré · ${String(input.payment.reference ?? "")}`,
    patch: {
      payments: mergeResult.rows as BackOfficeState["payments"],
      auditLog: appendAuditLog(
        state.auditLog,
        buildPaymentAuditEntry(input.payment, scopeUser, "payment.create"),
      ),
      notifications: notification
        ? [notification, ...(state.notifications ?? [])]
        : state.notifications,
    },
  };
}
