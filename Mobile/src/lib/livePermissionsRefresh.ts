import { attachCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import {
  buildEffectivePermissionsSnapshotV1,
  decidePermissionsRefreshFailure,
  type EffectivePermissionsSnapshotV1,
} from "./offlinePermissionsSnapshot";

/**
 * L8 — revalidation des permissions live Mobile.
 *
 * AuthContext reste l’unique autorité. Aucun polling. Aucun merge avec une
 * matrice locale. L’attribution et le retrait des droits n’existent pas dans
 * le runtime Mobile (L0b) : un changement Web est pris en compte au prochain
 * retour foreground.
 */

export type PermissionsBootstrapState = "idle" | "loading" | "ready" | "ready_offline" | "error";

export type AppLifecycleState = "active" | "background" | "inactive" | "unknown" | "extension";

export type EffectivePermissionsPayload = {
  permissions?: string[];
  roleKeys?: string[];
  modules?: unknown;
  source?: string;
  resolvedAt?: string;
};

export type RefreshableSession = {
  permissions?: string[];
  roleKeys?: string[];
  user?: {
    id?: string;
    permissions?: string[];
    roleKeys?: string[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

export function shouldRefreshPermissionsOnAppStateChange(
  previous: AppLifecycleState | null,
  next: AppLifecycleState,
): boolean {
  if (next !== "active") return false;
  if (previous === null) return false;
  if (previous === "active") return false;
  return previous === "background" || previous === "inactive";
}

export function planForegroundRefresh(input: {
  previous: AppLifecycleState | null;
  next: AppLifecycleState;
  hasSession: boolean;
}): "refresh" | "skip" {
  if (!input.hasSession) return "skip";
  return shouldRefreshPermissionsOnAppStateChange(input.previous, input.next) ? "refresh" : "skip";
}

export function applyLivePermissionsToSession<T extends RefreshableSession>(
  session: T,
  payload: EffectivePermissionsPayload,
): T {
  if (!Array.isArray(payload.permissions)) {
    throw new Error("effective-permissions: payload invalide");
  }
  const permissions = [...payload.permissions];
  const roleKeys = Array.isArray(payload.roleKeys) ? payload.roleKeys.slice() : undefined;
  const hasRoleKeys = roleKeys !== undefined;
  const nextUser = {
    ...(session.user ?? {}),
    permissions,
    ...(hasRoleKeys
      ? {
          roleKeys,
          roleKey: "",
          ...(roleKeys && roleKeys.length === 0
            ? {
                role: undefined,
              }
            : {}),
        }
      : {}),
  };
  const next = {
    ...session,
    permissions,
    ...(hasRoleKeys
      ? {
          roleKeys,
          roleKey: "",
          ...(roleKeys && roleKeys.length === 0
            ? {
                role: undefined,
                roleLabel: undefined,
              }
            : {}),
        }
      : {}),
    user: nextUser,
  };
  return attachCanonicalRoleIdentity(next) as T;
}

export function isMetierRenderable<T extends object>(
  session: T | null | undefined,
  bootstrap: PermissionsBootstrapState,
): session is T {
  return Boolean(session) && (bootstrap === "ready" || bootstrap === "ready_offline");
}

export function isUnauthorizedEffectivePermissionsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = Number((error as { status?: number }).status);
  return status === 401 || status === 403;
}

export function createRefreshGate() {
  let generation = 0;
  let inFlight: Promise<boolean> | null = null;
  let inFlightUserId: string | null = null;

  return {
    begin(userId: string, run: (generation: number) => Promise<boolean>): Promise<boolean> {
      if (inFlight && inFlightUserId === userId) return inFlight;
      const nextGeneration = generation + 1;
      generation = nextGeneration;
      inFlightUserId = userId;
      const promise = run(nextGeneration).finally(() => {
        if (generation === nextGeneration) {
          inFlight = null;
          inFlightUserId = null;
        }
      });
      inFlight = promise;
      return promise;
    },
    isCurrent(generationId: number, userId: string, currentUserId: string | null): boolean {
      return generationId === generation && Boolean(currentUserId) && currentUserId === userId;
    },
    invalidate() {
      generation += 1;
      inFlight = null;
      inFlightUserId = null;
    },
    currentGeneration() {
      return generation;
    },
  };
}

type RefresherDeps<T extends RefreshableSession> = {
  getSession: () => T | null;
  applySession: (session: T) => void;
  fetchEffectivePermissions: () => Promise<EffectivePermissionsPayload>;
  onAuthFailure: () => Promise<void> | void;
  onBootstrap: (state: PermissionsBootstrapState, error: string | null) => void;
  getOfflineSnapshot?: () => EffectivePermissionsSnapshotV1 | null;
  persistOfflineSnapshot?: (snapshot: EffectivePermissionsSnapshotV1) => Promise<void> | void;
};

function sessionUserId(session: RefreshableSession | null | undefined): string | null {
  const id = session?.user?.id;
  return id ? String(id) : null;
}

export function createEffectivePermissionsRefresher<T extends RefreshableSession>(deps: RefresherDeps<T>) {
  const gate = createRefreshGate();

  async function refresh(): Promise<boolean> {
    const current = deps.getSession();
    const userId = sessionUserId(current);
    if (!current || !userId) {
      deps.onBootstrap("idle", null);
      return false;
    }

    return gate.begin(userId, async (generation) => {
      deps.onBootstrap("loading", null);
      try {
        const payload = await deps.fetchEffectivePermissions();
        if (!gate.isCurrent(generation, userId, sessionUserId(deps.getSession()))) {
          return false;
        }
        if (!Array.isArray(payload?.permissions)) {
          throw new Error("effective-permissions: payload invalide");
        }
        const latest = deps.getSession();
        if (!latest?.user) {
          throw new Error("Session utilisateur absente après authentification.");
        }
        deps.applySession(applyLivePermissionsToSession(latest, payload));
        if (!gate.isCurrent(generation, userId, sessionUserId(deps.getSession()))) {
          return false;
        }
        const authoritative = deps.getSession();
        const snapshot = buildEffectivePermissionsSnapshotV1({
          session: authoritative,
          permissions: payload.permissions ?? [],
          roleKeys: Array.isArray(payload.roleKeys) ? payload.roleKeys : authoritative?.roleKeys,
          resolvedAt: payload.resolvedAt,
        });
        if (snapshot && deps.persistOfflineSnapshot) {
          await deps.persistOfflineSnapshot(snapshot);
        }
        if (!gate.isCurrent(generation, userId, sessionUserId(deps.getSession()))) {
          return false;
        }
        deps.onBootstrap("ready", null);
        return true;
      } catch (error) {
        // Stale 401/403 from a previous generation/session must never purge the
        // current session. Gate first; only the in-flight refresh may fail-closed.
        if (!gate.isCurrent(generation, userId, sessionUserId(deps.getSession()))) {
          return false;
        }
        if (isUnauthorizedEffectivePermissionsError(error)) {
          await deps.onAuthFailure();
          gate.invalidate();
          return false;
        }
        const decision = decidePermissionsRefreshFailure({
          error,
          session: deps.getSession(),
          snapshot: deps.getOfflineSnapshot?.() ?? null,
        });
        if (decision.action === "purge_auth") {
          await deps.onAuthFailure();
          gate.invalidate();
          return false;
        }
        if (decision.action === "ready_offline") {
          deps.onBootstrap("ready_offline", null);
          return false;
        }
        deps.onBootstrap("error", decision.reason);
        return false;
      }
    });
  }

  return {
    refresh,
    invalidate: () => gate.invalidate(),
    gate,
  };
}
