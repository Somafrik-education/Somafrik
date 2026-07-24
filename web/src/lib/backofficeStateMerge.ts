import type { BackOfficeState } from "../types";
import { dedupeAssignments } from "./pedagogySync";
import { isProtectedSyncStatus } from "./syncOutbox";

type Row = Record<string, unknown> & {
  id?: string;
  schoolCode?: string;
  identifier?: string;
  publicId?: string;
  syncStatus?: string;
};

function rowId(row: Row): string {
  return String(row.id ?? "");
}

function userIdentityKey(row: Row): string {
  const school = normalizeSchoolCode(row.schoolCode) || "*";
  const identity = String(row.id ?? row.publicId ?? row.identifier ?? "")
    .trim()
    .toLowerCase();
  return identity ? `${school}|${identity}` : "";
}

function mergeUsersByIdentity<T extends Row>(prev: T[] = [], remote: T[] = []): T[] {
  const map = new Map<string, T>();
  for (const row of prev) {
    const key = userIdentityKey(row);
    if (key) map.set(key, row);
  }
  for (const row of remote) {
    const key = userIdentityKey(row);
    if (key) map.set(key, row);
  }
  return [...map.values()];
}

function mergeScopedUserRows(prev: Row[] = [], remote: Row[] = []): Row[] {
  if (!remote.length && prev.length) return prev;
  const scope = schoolCodesInRows(remote);
  if (!scope.size) return remote.length ? remote : prev;
  const kept = prev.filter((row) => !scope.has(normalizeSchoolCode(row.schoolCode)));
  return mergeUsersByIdentity(kept, remote);
}

function normalizeSchoolCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function schoolCodesInRows(rows: Row[]): Set<string> {
  const codes = new Set<string>();
  for (const row of rows) {
    const code = normalizeSchoolCode(row.schoolCode);
    if (code) codes.add(code);
  }
  return codes;
}

/**
 * Fusionne deux listes par identifiant.
 * HOTFIX-SYNC-01 : une ligne locale pending/syncing/failed n'est jamais écrasée
 * par l'absence ou une version serveur plus ancienne.
 */
export function mergeRowsById<T extends Row>(prev: T[] = [], remote: T[] = []): T[] {
  const map = new Map<string, T>();

  for (const row of remote) {
    const id = rowId(row);
    if (id) map.set(id, row);
  }

  for (const row of prev) {
    const id = rowId(row);
    if (!id) continue;
    if (isProtectedSyncStatus(row.syncStatus)) {
      map.set(id, row);
      continue;
    }
    if (!map.has(id)) {
      map.set(id, row);
    }
  }

  return [...map.values()];
}

/**
 * Remplace les lignes des établissements présents dans `remote`, conserve le reste.
 * HOTFIX-SYNC-01 : conserve toujours les lignes locales non ACK du scope.
 */
export function mergeScopedSchoolRows<T extends Row>(prev: T[] = [], remote: T[] = []): T[] {
  if (!remote.length && prev.length) return prev;

  const scope = schoolCodesInRows(remote);
  if (!scope.size) return remote.length ? remote : prev;

  const pendingLocal = prev.filter((row) => isProtectedSyncStatus(row.syncStatus));
  const kept = prev.filter(
    (row) =>
      isProtectedSyncStatus(row.syncStatus) ||
      !scope.has(normalizeSchoolCode(row.schoolCode)),
  );

  const merged = mergeRowsById(kept, remote);
  // Réinjecte explicitement les pending (filet si remote a le même id sans syncStatus).
  return mergeRowsById(merged, pendingLocal);
}

/**
 * Ne remplace pas une liste locale non vide par un tableau vide reçu du serveur
 * (réponse partielle ou synchronisation incomplète).
 */
export function preferNonEmptyRemote<T>(prev: T[] | undefined, remote: T[] | undefined): T[] {
  const local = prev ?? [];
  const incoming = remote ?? [];
  if (!incoming.length && local.length) return local;
  return incoming.length ? incoming : local;
}

const SCHOOL_SCOPED_LIST_KEYS = [
  "contacts",
  "relations",
  "students",
  "teachers",
  "classes",
  "courses",
  "assignments",
  "courseSchedules",
  "payments",
  "paymentStatuses",
  "feeGrids",
  "schoolFeeItems",
  "studentFees",
  "feeTariffHistory",
  "presences",
  "notes",
  "evaluations",
  "exams",
  "bulletins",
  "documents",
  "announcements",
  "messages",
  "users",
] as const;

const GLOBAL_LIST_KEYS = [
  "countries",
  "subscriptions",
  "subscriptionOffers",
  "subscriptionPayments",
  "subscriptionInvoices",
  "subscriptionDiscounts",
  "subscriptionAuditLog",
  "notifications",
] as const;

function mergeUserRowsPreservingCredentials(prev: Row[] = [], remote: Row[] = []): Row[] {
  const prevByKey = new Map<string, Row>();
  for (const row of prev) {
    const key = userIdentityKey(row);
    if (key) prevByKey.set(key, row);
  }

  return mergeUsersByIdentity(prev, remote).map((row) => {
    const key = userIdentityKey(row);
    const existing = key ? prevByKey.get(key) : undefined;
    if (!existing) return row;

    const merged = { ...existing, ...row };
    const hasIncomingSecret =
      String(row.temporaryPassword ?? "").trim() || row.passwordHash || row.pinHash;
    if (!hasIncomingSecret) {
      if (existing.passwordHash) merged.passwordHash = existing.passwordHash;
      if (existing.pinHash) merged.pinHash = existing.pinHash;
      if (String(existing.temporaryPassword ?? "").trim()) {
        merged.temporaryPassword = existing.temporaryPassword;
      }
      if (existing.mustChangePassword != null) {
        merged.mustChangePassword = existing.mustChangePassword;
      }
      if (existing.hasTemporaryPassword != null) {
        merged.hasTemporaryPassword = existing.hasTemporaryPassword;
      }
    }
    return merged;
  });
}

function mergeSchoolScopedListKey(
  prev: BackOfficeState,
  remote: Partial<BackOfficeState>,
  key: (typeof SCHOOL_SCOPED_LIST_KEYS)[number],
): unknown {
  if (remote[key] === undefined) {
    return prev[key];
  }

  const merged =
    key === "users"
      ? mergeScopedUserRows(
          (prev[key] as unknown as Row[] | undefined) ?? [],
          (remote[key] as unknown as Row[] | undefined) ?? [],
        )
      : mergeScopedSchoolRows(
          (prev[key] as Row[] | undefined) ?? [],
          (remote[key] as Row[] | undefined) ?? [],
        );

  if (key === "users") {
    return mergeUserRowsPreservingCredentials(
      (prev[key] as unknown as Row[] | undefined) ?? [],
      merged,
    );
  }

  return key === "assignments" ? dedupeAssignments(merged) : merged;
}

/** Applique uniquement les clés présentes dans le patch (réponse PUT partielle). */
export function applyPartialSave(
  prev: BackOfficeState,
  saved: Partial<BackOfficeState>,
  patch: Partial<BackOfficeState>,
): BackOfficeState {
  const next: BackOfficeState = { ...prev };

  for (const key of Object.keys(patch) as (keyof BackOfficeState)[]) {
    if (!Object.prototype.hasOwnProperty.call(saved, key)) continue;
    const value = saved[key];
    if (value === undefined) continue;

    if ((SCHOOL_SCOPED_LIST_KEYS as readonly string[]).includes(key) && Array.isArray(value)) {
      (next as unknown as Record<string, unknown>)[key as string] = mergeSchoolScopedListKey(
        prev,
        { [key]: value } as Partial<BackOfficeState>,
        key as (typeof SCHOOL_SCOPED_LIST_KEYS)[number],
      );
      continue;
    }

    if ((GLOBAL_LIST_KEYS as readonly string[]).includes(key) && Array.isArray(value)) {
      (next as unknown as Record<string, unknown>)[key as string] = mergeRowsById(
        (prev[key] as Row[] | undefined) ?? [],
        value as Row[],
      );
      continue;
    }

    (next as unknown as Record<string, unknown>)[key as string] = value;
  }

  return next;
}

/** Fusion prudente d'un instantané GET avec l'état local. */
export function mergeRemoteSnapshot(
  prev: BackOfficeState,
  remote: Partial<BackOfficeState>,
): BackOfficeState {
  const remoteWithoutAck = { ...remote };
  delete (remoteWithoutAck as { syncAck?: unknown }).syncAck;

  const merged: BackOfficeState = { ...prev, ...remoteWithoutAck };

  if (remoteWithoutAck.schools !== undefined) {
    merged.schools = preferNonEmptyRemote(prev.schools, remoteWithoutAck.schools);
  }

  for (const key of SCHOOL_SCOPED_LIST_KEYS) {
    (merged as unknown as Record<string, unknown>)[key] = mergeSchoolScopedListKey(
      prev,
      remoteWithoutAck,
      key,
    );
  }

  for (const key of GLOBAL_LIST_KEYS) {
    if (remoteWithoutAck[key] !== undefined) {
      merged[key] = mergeRowsById(
        (prev[key] as Row[] | undefined) ?? [],
        (remoteWithoutAck[key] as Row[] | undefined) ?? [],
      ) as never;
    }
  }

  return merged;
}
