/**
 * LOT 2 — state.students est une projection de lecture PostgreSQL.
 * Le client ne doit jamais le renvoyer dans PUT /backoffice/state.
 */
export function stripClientStudentsFromPutPayload<T extends Record<string, unknown>>(payload: T): Omit<T, "students"> {
  if (!Object.prototype.hasOwnProperty.call(payload, "students")) {
    return payload;
  }
  const { students: _ignored, ...rest } = payload;
  return rest;
}
