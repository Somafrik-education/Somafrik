/**
 * LOT 1 — Les établissements ne sont plus writables via PUT /backoffice/state.
 * CRUD exclusivement via /api/backoffice/establishments (PostgreSQL).
 */

export function stripClientSchoolsFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "schools"> {
  if (!Object.prototype.hasOwnProperty.call(payload, "schools")) {
    return payload;
  }
  const rest = { ...payload };
  delete rest.schools;
  return rest;
}
