/**
 * P1-RC1-OFFLINE-01 — snapshot autoritatif des permissions live persistées.
 *
 * Source unique : dernier état serveur déjà persisté (login / effective-permissions).
 * Interdit : matrice locale, privilège universel inventé, defaults par rôle, expansion.
 */

import { isRecognizedTransportFailure } from "./connectivity";

function isUnauthorizedStatus(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = Number((error as { status?: number }).status);
  return status === 401 || status === 403;
}

export const EFFECTIVE_PERMISSIONS_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export const OFFLINE_PERMISSIONS_COPY = {
  unrevalidated: "Mode hors ligne — droits non revalidés",
} as const;

export type EffectivePermissionsSnapshotV1 = {
  schemaVersion: typeof EFFECTIVE_PERMISSIONS_SNAPSHOT_SCHEMA_VERSION;
  userId: string;
  schoolId: string;
  schoolCode: string;
  permissions: string[];
  roleKeys: string[];
  resolvedAt: string;
};

export type OfflinePermissionsDecision =
  | { action: "ready_offline"; snapshot: EffectivePermissionsSnapshotV1 }
  | { action: "purge_auth" }
  | { action: "error"; reason: string };

type SessionLike = {
  permissions?: string[];
  roleKeys?: string[];
  user?: {
    id?: string;
    schoolId?: string;
    schoolCode?: string;
    permissions?: string[];
    roleKeys?: string[];
    [key: string]: unknown;
  } | null;
  school?: {
    id?: string;
    code?: string;
    [key: string]: unknown;
  } | null;
};

function asTrimmed(value: unknown): string {
  return String(value ?? "").trim();
}

function asSchoolCode(value: unknown): string {
  return asTrimmed(value).toUpperCase();
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    next.push(item);
  }
  return next;
}

export function sessionIdentity(session: SessionLike | null | undefined): {
  userId: string;
  schoolId: string;
  schoolCode: string;
} {
  return {
    userId: asTrimmed(session?.user?.id),
    schoolId: asTrimmed(session?.school?.id ?? session?.user?.schoolId),
    schoolCode: asSchoolCode(session?.school?.code ?? session?.user?.schoolCode),
  };
}

export function isValidEffectivePermissionsSnapshot(
  value: unknown,
): value is EffectivePermissionsSnapshotV1 {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (Number(row.schemaVersion) !== EFFECTIVE_PERMISSIONS_SNAPSHOT_SCHEMA_VERSION) return false;
  if (asTrimmed(row.userId) === "") return false;
  const schoolId = asTrimmed(row.schoolId);
  const schoolCode = asSchoolCode(row.schoolCode);
  if (!schoolId && !schoolCode) return false;
  if (asStringList(row.permissions) == null) return false;
  if (asStringList(row.roleKeys) == null) return false;
  if (typeof row.resolvedAt !== "string" || !row.resolvedAt.trim()) return false;
  if ("accessToken" in row || "refreshToken" in row || "token" in row) return false;
  return true;
}

export function parseEffectivePermissionsSnapshotV1(raw: unknown): EffectivePermissionsSnapshotV1 | null {
  if (!isValidEffectivePermissionsSnapshot(raw)) return null;
  return {
    schemaVersion: EFFECTIVE_PERMISSIONS_SNAPSHOT_SCHEMA_VERSION,
    userId: asTrimmed(raw.userId),
    schoolId: asTrimmed(raw.schoolId),
    schoolCode: asSchoolCode(raw.schoolCode),
    permissions: (raw.permissions as string[]).slice(),
    roleKeys: (raw.roleKeys as string[]).slice(),
    resolvedAt: String(raw.resolvedAt).trim(),
  };
}

export function permissionsListsEqual(left: unknown, right: unknown): boolean {
  const a = asStringList(left);
  const b = asStringList(right);
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

export function snapshotMatchesSession(
  snapshot: EffectivePermissionsSnapshotV1,
  session: SessionLike | null | undefined,
): boolean {
  const identity = sessionIdentity(session);
  if (!identity.userId || snapshot.userId !== identity.userId) return false;
  if (identity.schoolCode && snapshot.schoolCode && snapshot.schoolCode !== identity.schoolCode) {
    return false;
  }
  if (identity.schoolId && snapshot.schoolId && snapshot.schoolId !== identity.schoolId) {
    return false;
  }
  if (!identity.schoolCode && !identity.schoolId) return false;
  if (!snapshot.schoolCode && !snapshot.schoolId) return false;
  return true;
}

export type OfflineSnapshotPersistDeps = {
  isCurrent: () => boolean;
  getSession: () => SessionLike | null | undefined;
  getMemorySnapshot: () => EffectivePermissionsSnapshotV1 | null;
  setMemorySnapshot: (snapshot: EffectivePermissionsSnapshotV1) => void;
  writeSnapshotStore: (snapshot: EffectivePermissionsSnapshotV1) => Promise<void> | void;
  writeSessionProfile: (
    session: SessionLike,
    snapshot: EffectivePermissionsSnapshotV1,
  ) => Promise<void> | void;
};

function restoreCurrentOfflineSnapshot(deps: OfflineSnapshotPersistDeps): EffectivePermissionsSnapshotV1 | null {
  const session = deps.getSession();
  const memory = deps.getMemorySnapshot();
  if (!session || !memory || !snapshotMatchesSession(memory, session)) return null;
  return memory;
}

/**
 * Persist a live snapshot only if its generation/session is still current.
 * A stale success must not touch memory, SecureStore snapshot, or the new user's profile.
 */
export async function persistOfflineSnapshotIfCurrent(
  snapshot: EffectivePermissionsSnapshotV1,
  deps: OfflineSnapshotPersistDeps,
): Promise<boolean> {
  const stillValid = () => deps.isCurrent() && snapshotMatchesSession(snapshot, deps.getSession());

  if (!stillValid()) return false;

  await deps.writeSnapshotStore(snapshot);
  if (!stillValid()) {
    const current = restoreCurrentOfflineSnapshot(deps);
    if (current) await deps.writeSnapshotStore(current);
    return false;
  }

  deps.setMemorySnapshot(snapshot);

  const session = deps.getSession();
  if (!session || !stillValid()) return false;

  await deps.writeSessionProfile(session, snapshot);
  if (!stillValid()) {
    const current = restoreCurrentOfflineSnapshot(deps);
    if (current) {
      const latest = deps.getSession();
      if (latest) await deps.writeSessionProfile(latest, current);
    }
    return false;
  }

  return true;
}

export function buildEffectivePermissionsSnapshotV1(input: {
  session: SessionLike | null | undefined;
  permissions: string[];
  roleKeys?: string[];
  resolvedAt?: string;
}): EffectivePermissionsSnapshotV1 | null {
  const identity = sessionIdentity(input.session);
  const permissions = asStringList(input.permissions);
  const roleKeys = asStringList(input.roleKeys ?? input.session?.roleKeys ?? input.session?.user?.roleKeys ?? []);
  if (!identity.userId || (!identity.schoolId && !identity.schoolCode) || !permissions || !roleKeys) {
    return null;
  }
  return parseEffectivePermissionsSnapshotV1({
    schemaVersion: EFFECTIVE_PERMISSIONS_SNAPSHOT_SCHEMA_VERSION,
    userId: identity.userId,
    schoolId: identity.schoolId,
    schoolCode: identity.schoolCode,
    permissions,
    roleKeys,
    resolvedAt: input.resolvedAt?.trim() || new Date().toISOString(),
  });
}

export function snapshotFromPersistedProfile(profile: SessionLike | null | undefined): EffectivePermissionsSnapshotV1 | null {
  const permissions = asStringList(profile?.permissions ?? profile?.user?.permissions);
  if (!permissions) return null;
  return buildEffectivePermissionsSnapshotV1({
    session: profile,
    permissions,
    roleKeys: asStringList(profile?.roleKeys ?? profile?.user?.roleKeys) ?? [],
    resolvedAt: new Date().toISOString(),
  });
}

/**
 * Fail-closed : le fallback offline n'existe que pour une vraie coupure transport.
 * 401/403, timeout, 4xx/5xx, payload invalide, mismatch → pas de ready_offline.
 */
export function decidePermissionsRefreshFailure(input: {
  error: unknown;
  session: SessionLike | null | undefined;
  snapshot: EffectivePermissionsSnapshotV1 | null;
}): OfflinePermissionsDecision {
  if (isUnauthorizedStatus(input.error)) {
    return { action: "purge_auth" };
  }

  const message =
    input.error instanceof Error && input.error.message.trim()
      ? input.error.message.trim()
      : "Impossible de charger les permissions effectives.";

  if (/payload invalide/i.test(message)) {
    return { action: "error", reason: message };
  }

  if (!isRecognizedTransportFailure(input.error)) {
    return { action: "error", reason: message };
  }

  if (!input.snapshot || !isValidEffectivePermissionsSnapshot(input.snapshot)) {
    return { action: "error", reason: "Permissions persistées absentes." };
  }

  if (!snapshotMatchesSession(input.snapshot, input.session)) {
    return { action: "error", reason: "Snapshot permissions incohérent avec la session." };
  }

  return { action: "ready_offline", snapshot: input.snapshot };
}

/** Garde-fou tests : un snapshot offline ne peut pas naître d'une matrice rôle. */
export function assertAuthoritativeOfflineSnapshot(snapshot: EffectivePermissionsSnapshotV1, sourcePermissions: string[]): void {
  if (!permissionsListsEqual(snapshot.permissions, sourcePermissions)) {
    throw new Error("OFFLINE_PERMISSIONS_EXPANSION_FORBIDDEN");
  }
}
