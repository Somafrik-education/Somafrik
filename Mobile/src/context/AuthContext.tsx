import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  LoginResponse,
  getEffectivePermissions,
  hasActiveAccessToken,
  logout as logoutSession,
  persistAuthenticatedSession,
} from "../services/api";
import { enrichSessionPermissions } from "../domain/security/permissions";
import { attachCanonicalRoleIdentity } from "../lib/canonicalRoleIdentity";
import { canRestorePersistedSession } from "../lib/dataTruth";
import { blockOutboxOnLogout } from "../lib/outbox";
import {
  parseEffectivePermissionsSnapshotV1,
  persistOfflineSnapshotIfCurrent,
  snapshotFromPersistedProfile,
  snapshotMatchesSession,
  type EffectivePermissionsSnapshotV1,
} from "../lib/offlinePermissionsSnapshot";
import { setSessionExpiredHandler } from "../services/httpClient";
import {
  clearSecureSession,
  getEffectivePermissionsSnapshotRaw,
  getSessionProfile,
  saveEffectivePermissionsSnapshot,
  saveSessionProfile,
} from "../services/secureStorage";
import { safeLogger } from "../services/safeLogger";
import { clearStoredSchoolCode } from "../lib/activeSchool";
import { clearRequestSchoolScope } from "../lib/requestSchoolScope";
import {
  createEffectivePermissionsRefresher,
  planForegroundRefresh,
  type PermissionsBootstrapState,
} from "../lib/livePermissionsRefresh";

export type { PermissionsBootstrapState };

type AuthContextValue = {
  session: LoginResponse | null;
  selectedStudentId: string | null;
  bootstrapping: boolean;
  permissionsBootstrap: PermissionsBootstrapState;
  permissionsBootstrapError: string | null;
  setSession: (session: LoginResponse | null) => void;
  setSelectedStudentId: (studentId: string) => void;
  refreshEffectivePermissions: () => Promise<boolean>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function stripSecrets(session: LoginResponse | null): LoginResponse | null {
  if (!session) return null;
  const { accessToken: _a, refreshToken: _r, ...rest } = session;
  return rest;
}

function permissionsBootstrapMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Impossible de charger les permissions effectives.";
}

function asPersistedProfile(profile: Awaited<ReturnType<typeof getSessionProfile>>): LoginResponse | null {
  if (!profile?.user) return null;
  return {
    role: profile.role as LoginResponse["role"],
    roleKeys: profile.roleKeys,
    permissions: profile.permissions,
    user: profile.user as LoginResponse["user"],
    school: profile.school as LoginResponse["school"],
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<LoginResponse | null>(null);
  const sessionRef = useRef<LoginResponse | null>(null);
  const snapshotRef = useRef<EffectivePermissionsSnapshotV1 | null>(null);
  const persistEpochRef = useRef(0);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [permissionsBootstrap, setPermissionsBootstrap] = useState<PermissionsBootstrapState>("idle");
  const [permissionsBootstrapError, setPermissionsBootstrapError] = useState<string | null>(null);

  const saveSession = useCallback((nextSession: LoginResponse | null, options?: { exactPermissions?: boolean }) => {
    if (!nextSession) {
      sessionRef.current = null;
      setSessionState(null);
      setSelectedStudentId(null);
      return null;
    }
    const stripped = stripSecrets(nextSession);
    const next = options?.exactPermissions
      ? (attachCanonicalRoleIdentity({
          ...stripped,
          permissions: Array.isArray(stripped?.permissions) ? stripped.permissions.slice() : stripped?.permissions,
          user: {
            ...stripped?.user,
            permissions: Array.isArray(stripped?.permissions)
              ? stripped.permissions.slice()
              : Array.isArray(stripped?.user?.permissions)
                ? stripped.user.permissions.slice()
                : stripped?.user?.permissions,
          },
        }) as LoginResponse)
      : enrichSessionPermissions(stripped);
    sessionRef.current = next;
    setSessionState(next);
    setSelectedStudentId(next?.user.children?.[0]?.id ?? next?.user.id ?? null);
    return next;
  }, []);

  const persistSnapshot = useCallback(async (snapshot: EffectivePermissionsSnapshotV1) => {
    const epoch = persistEpochRef.current;
    await persistOfflineSnapshotIfCurrent(snapshot, {
      isCurrent: () => epoch === persistEpochRef.current,
      getSession: () => sessionRef.current,
      getMemorySnapshot: () => snapshotRef.current,
      setMemorySnapshot: (next) => {
        snapshotRef.current = next;
      },
      writeSnapshotStore: async (next) => {
        await saveEffectivePermissionsSnapshot(JSON.stringify(next));
      },
      writeSessionProfile: async (session, next) => {
        const current = session as LoginResponse;
        if (!current?.user) return;
        await saveSessionProfile({
          role: current.role,
          roleKeys: next.roleKeys,
          permissions: next.permissions,
          user: {
            ...(current.user as unknown as Record<string, unknown>),
            permissions: next.permissions,
            roleKeys: next.roleKeys,
          },
          ...(current.school ? { school: current.school as unknown as Record<string, unknown> } : {}),
        });
      },
    });
  }, []);

  const refresherRef = useRef(
    createEffectivePermissionsRefresher<LoginResponse>({
      getSession: () => sessionRef.current,
      applySession: (next) => {
        saveSession(next);
      },
      fetchEffectivePermissions: getEffectivePermissions,
      getOfflineSnapshot: () => snapshotRef.current,
      persistOfflineSnapshot: persistSnapshot,
      onAuthFailure: async () => {
        persistEpochRef.current += 1;
        snapshotRef.current = null;
        await clearSecureSession().catch(() => undefined);
        saveSession(null);
        setPermissionsBootstrap("idle");
        setPermissionsBootstrapError(null);
      },
      onBootstrap: (state, message) => {
        setPermissionsBootstrap(state);
        setPermissionsBootstrapError(message);
      },
    }),
  );

  const clearAuthenticatedState = useCallback(() => {
    persistEpochRef.current += 1;
    refresherRef.current.invalidate();
    snapshotRef.current = null;
    saveSession(null);
    setPermissionsBootstrap("idle");
    setPermissionsBootstrapError(null);
  }, [saveSession]);

  const refreshEffectivePermissions = useCallback(async () => {
    return refresherRef.current.refresh();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const hasToken = await hasActiveAccessToken();
        const profile = await getSessionProfile();
        if (!mounted) return;
        if (!canRestorePersistedSession({ hasAccessToken: hasToken, profile })) {
          if (profile?.user?.mustChangePassword) {
            await clearSecureSession();
          }
          return;
        }
        if (!profile) return;

        const restored = asPersistedProfile(profile);
        if (!restored) return;

        let snapshot: EffectivePermissionsSnapshotV1 | null = null;
        try {
          const raw = await getEffectivePermissionsSnapshotRaw();
          snapshot = parseEffectivePermissionsSnapshotV1(raw ? JSON.parse(raw) : null);
        } catch {
          snapshot = null;
        }
        if (!snapshot) {
          snapshot = snapshotFromPersistedProfile(restored);
        }

        if (snapshot && !snapshotMatchesSession(snapshot, restored)) {
          await clearSecureSession();
          return;
        }

        if (snapshot) {
          snapshotRef.current = snapshot;
          saveSession(
            {
              ...restored,
              permissions: snapshot.permissions,
              roleKeys: snapshot.roleKeys,
              user: {
                ...restored.user,
                permissions: snapshot.permissions,
                roleKeys: snapshot.roleKeys,
              },
            },
            { exactPermissions: true },
          );
        } else if (Array.isArray(restored.permissions) || Array.isArray(restored.user?.permissions)) {
          saveSession(restored, { exactPermissions: true });
        } else {
          saveSession(restored, { exactPermissions: true });
        }

        await refreshEffectivePermissions();
      } catch (error) {
        safeLogger.warn("session restore failed", error);
        await clearSecureSession();
        clearAuthenticatedState();
      } finally {
        if (mounted) setBootstrapping(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [clearAuthenticatedState, refreshEffectivePermissions, saveSession]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearAuthenticatedState();
    });
    return () => setSessionExpiredHandler(null);
  }, [clearAuthenticatedState]);

  useEffect(() => {
    const appStateRef = { current: AppState.currentState as AppStateStatus };
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      const decision = planForegroundRefresh({
        previous,
        next,
        hasSession: Boolean(sessionRef.current),
      });
      if (decision === "refresh") {
        void refreshEffectivePermissions();
      }
    });
    return () => subscription.remove();
  }, [refreshEffectivePermissions]);

  const setSession = useCallback(
    (next: LoginResponse | null) => {
      if (!next) {
        clearAuthenticatedState();
        return;
      }

      if (next.user?.mustChangePassword) {
        if (next.accessToken || next.refreshToken) {
          void persistAuthenticatedSession(next);
        }
        return;
      }

      persistEpochRef.current += 1;
      refresherRef.current.invalidate();
      setPermissionsBootstrap("loading");
      setPermissionsBootstrapError(null);

      // Installer immédiatement une session sans secrets afin que le navigateur
      // authentifié tombe dans le gate `loading` au même rendu. On ne laisse
      // jamais Home s'afficher pendant une éventuelle persistance asynchrone.
      saveSession(stripSecrets(next));

      const persistAndHydrate = async () => {
        try {
          // Le chemin login() fournit déjà une session sans secrets après avoir
          // persisté les tokens. On ne réécrit SecureStore que si un appelant
          // fournit explicitement de nouveaux tokens.
          if (next.accessToken || next.refreshToken) {
            await persistAuthenticatedSession(next);
          }
          const persisted = snapshotFromPersistedProfile(stripSecrets(next) ?? next);
          if (persisted) snapshotRef.current = persisted;
          await refreshEffectivePermissions();
        } catch (error) {
          safeLogger.warn("session permission bootstrap failed", error);
          setPermissionsBootstrap("error");
          setPermissionsBootstrapError(permissionsBootstrapMessage(error));
        }
      };

      void persistAndHydrate();
    },
    [clearAuthenticatedState, refreshEffectivePermissions, saveSession],
  );

  const logout = useCallback(() => {
    clearRequestSchoolScope();
    clearStoredSchoolCode();
    clearAuthenticatedState();
    void blockOutboxOnLogout().finally(() => {
      void logoutSession().catch(() => undefined);
    });
  }, [clearAuthenticatedState]);

  const value = useMemo(
    () => ({
      session,
      selectedStudentId,
      bootstrapping,
      permissionsBootstrap,
      permissionsBootstrapError,
      setSession,
      setSelectedStudentId,
      refreshEffectivePermissions,
      logout,
    }),
    [
      session,
      selectedStudentId,
      bootstrapping,
      permissionsBootstrap,
      permissionsBootstrapError,
      setSession,
      refreshEffectivePermissions,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth doit etre utilise dans AuthProvider");
  }

  return context;
}
