/**
 * LOT 6 — state Plateforme est une projection PostgreSQL de lecture.
 * Le client ne doit jamais renvoyer ces clés dans PUT /backoffice/state.
 */

export const CLIENT_PLATFORM_STATE_KEYS = [
  "countries",
  "subscriptions",
  "subscriptionOffers",
  "subscriptionPayments",
  "subscriptionInvoices",
  "subscriptionDiscounts",
  "subscriptionAuditLog",
  "notifications",
  "rolePermissions",
  "dashboardChartConfig",
] as const;

export function stripClientPlatformFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, (typeof CLIENT_PLATFORM_STATE_KEYS)[number]> {
  const next = { ...payload } as Record<string, unknown>;
  for (const key of CLIENT_PLATFORM_STATE_KEYS) {
    delete next[key];
  }
  return next as Omit<T, (typeof CLIENT_PLATFORM_STATE_KEYS)[number]>;
}
