import type { BackOfficeState } from "../types";
import {
  isOfflineCapableDomain,
  isSchoolScopedCanonicalKey,
  SCHOOL_SCOPED_CANONICAL_KEYS,
} from "./canonicalDomains";
import { dedupeAssignments } from "./pedagogySync";
import { isPendingSyncStatus } from "./syncOutbox";

type Row = Record<string, unknown> & {
  id?: string;
  schoolCode?: string;
  identifier?: string;
  publicId?: string;
  syncStatus?: string;
};

export interface MergeRemoteSnapshotOptions {
  /** Établissement actif — nécessaire pour remplacer un scope vide (GET []). */
  activeSchoolCode?: string;
  /** Clés effectivement chargées dans ce snapshot (remplacement partiel). */
  loadedKeys?: (keyof BackOfficeState)[];
}

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

function scopesToReplace(remote: Row[], activeSchoolCode?: string): Set<string> {
  const scopes = schoolCodesInRows(remote);
  const active = normalizeSchoolCode(activeSchoolCode);
  if (active && active !== "*") scopes.add(active);
  return scopes;
}

/**
 * Remplace les lignes d'un scope établissement par la réponse serveur.
 * GET scope S réussi → toutes les lignes du scope S = remote (y compris []).
 */
export function replaceScopedSchoolRows<T extends Row>(
  prev: T[] = [],
  remote: T[] = [],
  options: { activeSchoolCode?: string; domainKey?: string } = {},
): T[] {
  const scopes = scopesToReplace(remote, options.activeSchoolCode);
  const domainKey = options.domainKey ?? "";

  if (!scopes.size) {
    return remote;
  }

  const kept = prev.filter((row) => !scopes.has(normalizeSchoolCode(row.schoolCode)));

  let authoritative = [...remote];

  if (isOfflineCapableDomain(domainKey)) {
    const pendingInScope = prev.filter(
      (row) =>
        scopes.has(normalizeSchoolCode(row.schoolCode)) && isPendingSyncStatus(row.syncStatus),
    );
    authoritative = overlayPendingRows(authoritative, pendingInScope);
  }

  return [...kept, ...authoritative];
}

/** Remplace une liste globale par la réponse serveur (remote = [] efface le domaine). */
export function replaceGlobalRows<T extends Row>(
  prev: T[] = [],
  remote: T[] = [],
  options: { domainKey?: string } = {},
): T[] {
  const domainKey = options.domainKey ?? "";
  let authoritative = [...remote];

  if (isOfflineCapableDomain(domainKey)) {
    const pending = prev.filter((row) => isPendingSyncStatus(row.syncStatus));
    authoritative = overlayPendingRows(authoritative, pending);
  }

  return authoritative;
}

/** Conserve uniquement les lignes pending/syncing locales absentes du serveur. */
function overlayPendingRows<T extends Row>(remote: T[], pending: T[]): T[] {
  if (!pending.length) return remote;
  const map = new Map<string, T>();
  for (const row of remote) {
    const id = rowId(row);
    if (id) map.set(id, row);
  }
  for (const row of pending) {
    const id = rowId(row);
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, row);
      continue;
    }
    map.set(id, { ...map.get(id)!, ...row, syncStatus: row.syncStatus });
  }
  return [...map.values()];
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

function replaceScopedUserRows(
  prev: Row[] = [],
  remote: Row[] = [],
  activeSchoolCode?: string,
): Row[] {
  const scopes = scopesToReplace(remote, activeSchoolCode);
  if (!scopes.size) return remote;

  const kept = prev.filter((row) => !scopes.has(normalizeSchoolCode(row.schoolCode)));
  const authoritative = mergeUsersByIdentity(
    prev.filter((row) => scopes.has(normalizeSchoolCode(row.schoolCode)) && isPendingSyncStatus(row.syncStatus)),
    remote,
  );
  return mergeUsersByIdentity(kept, authoritative);
}

function mergeUserRowsPreservingCredentials(prev: Row[] = [], remote: Row[] = []): Row[] {
  const prevByKey = new Map<string, Row>();
  for (const row of prev) {
    const key = userIdentityKey(row);
    if (key) prevByKey.set(key, row);
  }

  return remote.map((row) => {
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
  key: (typeof SCHOOL_SCOPED_CANONICAL_KEYS)[number],
  activeSchoolCode?: string,
): unknown {
  if (remote[key] === undefined) {
    return prev[key];
  }

  const remoteRows = (remote[key] as Row[] | undefined) ?? [];

  const merged =
    key === "users"
      ? replaceScopedUserRows(
          (prev[key] as unknown as Row[] | undefined) ?? [],
          remoteRows,
          activeSchoolCode,
        )
      : replaceScopedSchoolRows(
          (prev[key] as Row[] | undefined) ?? [],
          remoteRows,
          { activeSchoolCode, domainKey: key },
        );

  if (key === "users") {
    return mergeUserRowsPreservingCredentials(
      (prev[key] as unknown as Row[] | undefined) ?? [],
      merged,
    );
  }

  return key === "assignments" ? dedupeAssignments(merged) : merged;
}

function mergeAcademicConfigs(
  prev: BackOfficeState["academicConfigs"],
  remote: BackOfficeState["academicConfigs"] | undefined,
  activeSchoolCode?: string,
): BackOfficeState["academicConfigs"] {
  if (!remote) return prev;
  const next = { ...prev };
  const active = normalizeSchoolCode(activeSchoolCode);
  if (active && active !== "*") {
    if (remote[activeSchoolCode!] !== undefined) {
      next[activeSchoolCode!] = remote[activeSchoolCode!];
    } else {
      const match = Object.entries(remote).find(
        ([code]) => normalizeSchoolCode(code) === active,
      );
      if (match) next[match[0]] = match[1];
      else delete next[activeSchoolCode!];
    }
    return next;
  }
  return { ...next, ...remote };
}

/** Applique uniquement les clés présentes dans le patch (réponse PUT partielle résiduelle). */
export function applyPartialSave(
  prev: BackOfficeState,
  saved: Partial<BackOfficeState>,
  patch: Partial<BackOfficeState>,
  options: MergeRemoteSnapshotOptions = {},
): BackOfficeState {
  const next: BackOfficeState = { ...prev };
  const activeSchoolCode = options.activeSchoolCode;

  for (const key of Object.keys(patch) as (keyof BackOfficeState)[]) {
    if (!Object.prototype.hasOwnProperty.call(saved, key)) continue;
    const value = saved[key];
    if (value === undefined) continue;

    if (isSchoolScopedCanonicalKey(key) && Array.isArray(value)) {
      (next as unknown as Record<string, unknown>)[key as string] = mergeSchoolScopedListKey(
        prev,
        { [key]: value } as Partial<BackOfficeState>,
        key as (typeof SCHOOL_SCOPED_CANONICAL_KEYS)[number],
        activeSchoolCode,
      );
      continue;
    }

    if (key === "schools" && Array.isArray(value)) {
      (next as unknown as Record<string, unknown>)[key as string] = replaceGlobalRows(
        (prev.schools as unknown as Row[] | undefined) ?? [],
        value as unknown as Row[],
        { domainKey: "schools" },
      );
      continue;
    }

    if (Array.isArray(value) && key !== "auditLog") {
      (next as unknown as Record<string, unknown>)[key as string] = replaceGlobalRows(
        (prev[key] as Row[] | undefined) ?? [],
        value as Row[],
        { domainKey: String(key) },
      );
      continue;
    }

    (next as unknown as Record<string, unknown>)[key as string] = value;
  }

  return next;
}

/**
 * Fusion d'un instantané GET avec l'état local.
 * PostgreSQL gagne : une ligne absente du GET disparaît (sauf pending offline-capable).
 */
export function mergeRemoteSnapshot(
  prev: BackOfficeState,
  remote: Partial<BackOfficeState>,
  options: MergeRemoteSnapshotOptions = {},
): BackOfficeState {
  const remoteWithoutAck = { ...remote };
  delete (remoteWithoutAck as { syncAck?: unknown }).syncAck;

  const loadedKeys = options.loadedKeys ?? (Object.keys(remoteWithoutAck) as (keyof BackOfficeState)[]);
  const activeSchoolCode = options.activeSchoolCode;
  const merged: BackOfficeState = { ...prev };

  for (const key of loadedKeys) {
    if (remoteWithoutAck[key] === undefined) continue;

    if (isSchoolScopedCanonicalKey(key)) {
      (merged as unknown as Record<string, unknown>)[key as string] = mergeSchoolScopedListKey(
        prev,
        remoteWithoutAck,
        key as (typeof SCHOOL_SCOPED_CANONICAL_KEYS)[number],
        activeSchoolCode,
      );
      continue;
    }

    if (key === "schools" && Array.isArray(remoteWithoutAck.schools)) {
      merged.schools = replaceGlobalRows(
        (prev.schools as unknown as Row[] | undefined) ?? [],
        remoteWithoutAck.schools as unknown as Row[],
        { domainKey: "schools" },
      ) as unknown as BackOfficeState["schools"];
      continue;
    }

    if (key === "academicConfigs") {
      merged.academicConfigs = mergeAcademicConfigs(
        prev.academicConfigs,
        remoteWithoutAck.academicConfigs,
        activeSchoolCode,
      );
      continue;
    }

    if (key === "rolePermissions" || key === "dashboardChartConfig") {
      merged[key] = remoteWithoutAck[key] as never;
      continue;
    }

    if (Array.isArray(remoteWithoutAck[key])) {
      (merged as unknown as Record<string, unknown>)[key as string] = replaceGlobalRows(
        (prev[key] as Row[] | undefined) ?? [],
        remoteWithoutAck[key] as Row[],
        { domainKey: String(key) },
      );
    } else {
      (merged as unknown as Record<string, unknown>)[key as string] = remoteWithoutAck[key];
    }
  }

  return merged;
}

/** Retire les données d'un établissement inactif des listes scopées (changement d'établissement). */
export function purgeSchoolScopedRowsForCode<T extends Row>(
  rows: T[] | undefined,
  schoolCode: string,
): T[] {
  const scope = normalizeSchoolCode(schoolCode);
  if (!scope || scope === "*") return rows ?? [];
  return (rows ?? []).filter((row) => normalizeSchoolCode(row.schoolCode) !== scope);
}

export function purgeInactiveSchoolFromState(
  state: BackOfficeState,
  inactiveSchoolCode: string,
): BackOfficeState {
  const scope = normalizeSchoolCode(inactiveSchoolCode);
  if (!scope || scope === "*") return state;

  const next: BackOfficeState = { ...state };
  for (const key of SCHOOL_SCOPED_CANONICAL_KEYS) {
    const list = state[key];
    if (Array.isArray(list)) {
      (next as unknown as Record<string, unknown>)[key] = purgeSchoolScopedRowsForCode(
        list as Row[],
        inactiveSchoolCode,
      );
    }
  }

  const configs = { ...state.academicConfigs };
  for (const code of Object.keys(configs)) {
    if (normalizeSchoolCode(code) === scope) delete configs[code];
  }
  next.academicConfigs = configs;

  return next;
}

// Rétrocompatibilité tests / imports existants
export const mergeRowsById = replaceGlobalRows;
export const mergeScopedSchoolRows = replaceScopedSchoolRows;
