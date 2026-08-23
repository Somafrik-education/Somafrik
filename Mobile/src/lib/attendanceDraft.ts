/**
 * Cycle de vie du brouillon d'appel : dirty local vs autorité PostgreSQL.
 */

export type AttendanceDraftEntry = {
  status: string | null;
  arrivalTime?: string;
  reason?: string;
  modifiedAt?: string;
  modifiedBy?: string;
  previousStatus?: string | null;
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

export type PresenceIdentity = {
  id?: string;
  publicId?: string;
  studentId?: string;
  date?: string;
};

function presenceIdentityKey(row: PresenceIdentity): string {
  const id = String(row.id ?? row.publicId ?? "").trim();
  if (id) return `id:${id}`;
  return `stu:${String(row.studentId ?? "").trim()}|date:${String(row.date ?? "").trim()}`;
}

/** Fusionne le POST confirmé dans le store local, même si le GET de refresh échoue. */
export function mergeConfirmedPresences<T extends PresenceIdentity>(previous: T[], saved: T[]): T[] {
  if (!Array.isArray(saved) || !saved.length) return previous;
  const next = [...previous];
  for (const row of saved) {
    const key = presenceIdentityKey(row);
    const index = next.findIndex((item) => presenceIdentityKey(item) === key);
    if (index >= 0) {
      next[index] = { ...next[index], ...row };
    } else {
      next.push(row);
    }
  }
  return next;
}

/**
 * Après POST confirmé : le store reflète savedPresences si le refresh GET échoue,
 * et les marqueurs dirty disparaissent pour que la réhydratation lise cette autorité.
 */
export function hydrateAttendanceAfterConfirmedSave<T extends AttendanceDraftEntry, P extends PresenceIdentity>(input: {
  attendance: Record<string, T>;
  studentIds: string[];
  previousPresences: P[];
  savedPresences: P[];
  refreshedPresences?: P[] | null;
  refreshSucceeded: boolean;
}): { attendance: Record<string, T>; presences: P[] } {
  const presences =
    input.refreshSucceeded && Array.isArray(input.refreshedPresences)
      ? input.refreshedPresences
      : mergeConfirmedPresences(input.previousPresences, input.savedPresences);
  return {
    attendance: clearConfirmedAttendanceDirty(input.attendance, input.studentIds),
    presences,
  };
}
