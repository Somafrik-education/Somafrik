/** LOT 3 — teachers/assignments sont des projections PostgreSQL read-only dans le state global. */
export function stripClientPedagogyStaffFromPutPayload<T extends Record<string, unknown>>(
  payload: T,
): Omit<T, "teachers" | "assignments"> {
  const canonical = { ...payload } as Record<string, unknown>;
  delete canonical.teachers;
  delete canonical.assignments;
  return canonical as Omit<T, "teachers" | "assignments">;
}
