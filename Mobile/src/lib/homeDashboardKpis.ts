import {
  ACTIVE_USERS_KPI_LABEL,
  countActiveUserAccounts,
  isActiveUserAccount,
  type UserAccountActivityFields,
} from "./format";
import {
  PAYMENT_RATE_KPI_LABEL,
  formatPaymentRateKpi,
  type StudentFeeObligation,
} from "./paymentRateKpi";

export { ACTIVE_USERS_KPI_LABEL, countActiveUserAccounts, isActiveUserAccount };
export type { UserAccountActivityFields };
export { PAYMENT_RATE_KPI_LABEL };
export type { StudentFeeObligation };

/** Libellé KPI Accueil : nombre de paiements canoniques du périmètre, jamais un taux. */
export const PAYMENTS_KPI_LABEL = "Paiements";

export function formatHomeActiveUsersKpi(users: readonly UserAccountActivityFields[]): {
  label: string;
  value: string;
} {
  return {
    label: ACTIVE_USERS_KPI_LABEL,
    value: String(countActiveUserAccounts(users)),
  };
}

export function formatHomePaymentsKpi(payments: readonly unknown[]): {
  label: string;
  value: string;
} {
  return {
    label: PAYMENTS_KPI_LABEL,
    value: String(payments.length),
  };
}

export function formatHomePaymentRateKpi(fees: readonly StudentFeeObligation[]): {
  label: string;
  value: string;
} {
  return formatPaymentRateKpi(fees);
}
