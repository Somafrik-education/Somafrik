/**
 * LOT 7 — state Clients est une projection PostgreSQL de lecture.
 */

export const CLIENT_CLIENTS_STATE_KEYS = [
  "users",
  "contacts",
  "relations",
  "messages",
  "announcements",
] as const;

export function stripClientClientsFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, (typeof CLIENT_CLIENTS_STATE_KEYS)[number]> {
  const next = { ...payload } as Record<string, unknown>;
  for (const key of CLIENT_CLIENTS_STATE_KEYS) {
    delete next[key];
  }
  return next as Omit<T, (typeof CLIENT_CLIENTS_STATE_KEYS)[number]>;
}
