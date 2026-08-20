/**
 * Cycle de vie du brouillon d'appel : dirty local vs autorité PostgreSQL.
 */

export type AttendanceDraftEntry = {
  status: string;
  arrivalTime?: string;
  reason?: string;
  modifiedAt?: string;
  modifiedBy?: string;
  previousStatus?: string;
};

export function shouldPreserveLocalAttendanceDraft(entry?: { modifiedAt?: string } | null): boolean {
  return Boolean(entry?.modifiedAt);
}

/**
 * Après confirmation backend, les marqueurs dirty doivent disparaître
 * pour que le prochain chargement PostgreSQL redevienne l'autorité.
 */
export function clearConfirmedAttendanceDirty<T extends AttendanceDraftEntry>(
  attendance: Record<string, T>,
  studentIds: string[],
): Record<string, T> {
  const next = { ...attendance };
  for (const studentId of studentIds) {
    const entry = next[studentId];
    if (!entry) continue;
    next[studentId] = {
      ...entry,
      modifiedAt: undefined,
      modifiedBy: undefined,
      previousStatus: undefined,
    };
  }
  return next;
}
