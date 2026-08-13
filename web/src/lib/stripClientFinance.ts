/**
 * LOT 4 — state Finance est une projection PostgreSQL de lecture.
 * Le client ne doit jamais renvoyer ces clés dans PUT /backoffice/state.
 */

export const CLIENT_FINANCE_STATE_KEYS = [
  "feeGrids",
  "feeTariffHistory",
  "paymentReminders",
  "paymentStatuses",
  "payments",
  "schoolFeeItems",
  "studentFees",
] as const;

export function stripClientFinanceFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, (typeof CLIENT_FINANCE_STATE_KEYS)[number]> {
  const next = { ...payload } as Record<string, unknown>;
  for (const key of CLIENT_FINANCE_STATE_KEYS) {
    delete next[key];
  }
  return next as Omit<T, (typeof CLIENT_FINANCE_STATE_KEYS)[number]>;
}
