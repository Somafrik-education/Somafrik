import {
  ACTIVE_USERS_KPI_LABEL,
  countActiveUserAccounts,
  isActiveUserAccount,
  type UserAccountActivityFields,
} from "./format";
import { isPaidStatus } from "./dataTruth";

export { ACTIVE_USERS_KPI_LABEL, countActiveUserAccounts, isActiveUserAccount };
export type { UserAccountActivityFields };

/** Libellé KPI Accueil : nombre de paiements canoniques du périmètre, jamais un taux. */
export const PAYMENTS_KPI_LABEL = "Paiements";

/** Libellé KPI Accueil Admin : taux de paiements réglés, jamais confondu avec le compteur Paiements. */
export const PAYMENT_RATE_KPI_LABEL = "Taux de paiement";

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

export function formatHomePaymentRateKpi(payments: ReadonlyArray<{ status?: string }>): {
  label: string;
  value: string;
} {
  const paid = payments.filter((payment) => isPaidStatus(payment.status)).length;
  const rate = payments.length ? Math.round((paid / payments.length) * 100) : 0;
  return {
    label: PAYMENT_RATE_KPI_LABEL,
    value: `${rate} %`,
  };
}
