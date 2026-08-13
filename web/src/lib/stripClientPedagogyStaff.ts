/** LOT 3 — teachers/assignments sont des projections PostgreSQL read-only dans le state global. */
export function stripClientPedagogyStaffFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "teachers" | "assignments"> {
  const { teachers: _teachers, assignments: _assignments, ...rest } = payload;
  return rest;
}

