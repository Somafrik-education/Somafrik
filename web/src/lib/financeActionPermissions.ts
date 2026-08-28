/**
 * F7 — visibilité des actions Finance Web.
 * Source : permissions effectives du principal (F6). Aucun `role ===`.
 */
import type { PermissionContext } from "./permissions";
import { hasBackOfficePermission } from "./permissions";

export const FINANCE_PAYMENT_FEATURE = "Paiements";
export const FINANCE_FEE_FEATURE = "Frais & tarifs";
export const FINANCE_UNPAID_FEATURE = "Impayés";
export const FINANCE_SETTINGS_FEATURE = "Paramètres Établissement";

export type FinanceUiActions = {
  canConsultPayments: boolean;
  canCreatePayment: boolean;
  canCancelPayment: boolean;
  canConsultBalances: boolean;
  canConsultFees: boolean;
  canCreateObligation: boolean;
  canUpdateFees: boolean;
  canConsultUnpaid: boolean;
  canSendReminder: boolean;
  canManageCatalog: boolean;
  canExport: boolean;
};

export function resolveFinanceUiActions(ctx: PermissionContext): FinanceUiActions {
  const canConsultPayments = hasBackOfficePermission(ctx, FINANCE_PAYMENT_FEATURE, "READ");
  const canConsultFees = hasBackOfficePermission(ctx, FINANCE_FEE_FEATURE, "READ");
  const canConsultUnpaid = hasBackOfficePermission(ctx, FINANCE_UNPAID_FEATURE, "READ");
  const canConsultBalances = canConsultPayments || canConsultFees || canConsultUnpaid;
  return {
    canConsultPayments,
    canCreatePayment:
      hasBackOfficePermission(ctx, FINANCE_PAYMENT_FEATURE, "CREATE") ||
      hasBackOfficePermission(ctx, FINANCE_PAYMENT_FEATURE, "UPDATE"),
    canCancelPayment: hasBackOfficePermission(ctx, FINANCE_PAYMENT_FEATURE, "UPDATE"),
    canConsultBalances,
    canConsultFees,
    canCreateObligation: hasBackOfficePermission(ctx, FINANCE_FEE_FEATURE, "UPDATE"),
    canUpdateFees: hasBackOfficePermission(ctx, FINANCE_FEE_FEATURE, "UPDATE"),
    canConsultUnpaid,
    canSendReminder:
      hasBackOfficePermission(ctx, FINANCE_UNPAID_FEATURE, "CREATE") ||
      hasBackOfficePermission(ctx, FINANCE_PAYMENT_FEATURE, "UPDATE"),
    canManageCatalog:
      hasBackOfficePermission(ctx, FINANCE_FEE_FEATURE, "UPDATE") ||
      hasBackOfficePermission(ctx, FINANCE_SETTINGS_FEATURE, "UPDATE"),
    canExport: canConsultPayments,
  };
}
