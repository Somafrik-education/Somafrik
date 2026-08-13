/**
 * LOT 5 — state pédagogie est une projection PostgreSQL de lecture.
 * Le client ne doit jamais renvoyer ces clés dans PUT /backoffice/state.
 */

export const CLIENT_PEDAGOGY_STATE_KEYS = [
  "courseSchedules",
  "courses",
  "evaluations",
  "notes",
  "presences",
] as const;

export function stripClientPedagogyFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, (typeof CLIENT_PEDAGOGY_STATE_KEYS)[number]> {
  const next = { ...payload } as Record<string, unknown>;
  for (const key of CLIENT_PEDAGOGY_STATE_KEYS) {
    delete next[key];
  }
  return next as Omit<T, (typeof CLIENT_PEDAGOGY_STATE_KEYS)[number]>;
}
