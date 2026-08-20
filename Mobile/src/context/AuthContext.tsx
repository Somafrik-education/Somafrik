import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  LoginResponse,
  getEffectivePermissions,
  hasActiveAccessToken,
  logout as logoutSession,
  persistAuthenticatedSession,
} from "../services/api";
import { enrichSessionPermissions } from "../domain/security/permissions";
import { canRestorePersistedSession } from "../lib/dataTruth";
import { blockOutboxOnLogout } from "../lib/outbox";
import { ApiClientError, setSessionExpiredHandler } from "../services/httpClient";
import { clearSecureSession, getSessionProfile } from "../services/secureStorage";
import { safeLogger } from "../services/safeLogger";
import { clearStoredSchoolCode } from "../lib/activeSchool";
import { clearRequestSchoolScope } from "../lib/requestSchoolScope";

export type PermissionsBootstrapState = "idle" | "loading" | "ready" | "error";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<LoginResponse | null>(null);
  const sessionRef = useRef<LoginResponse | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [permissionsBootstrap, setPermissionsBootstrap] = useState<PermissionsBootstrapState>("idle");
  const [permissionsBootstrapError, setPermissionsBootstrapError] = useState<string | null>(null);

  const saveSession = useCallback((nextSession: LoginResponse | null) => {
    const enriched = enrichSessionPermissions(stripSecrets(nextSession));
    sessionRef.current = enriched;
    setSessionState(enriched);
    setSelectedStudentId(enriched?.user.children?.[0]?.id ?? enriched?.user.id ?? null);
    return enriched;
  }, []);

  const clearAuthenticatedState = useCallback(() => {
    saveSession(null);
    setPermissionsBootstrap("idle");
    setPermissionsBootstrapError(null);
  }, [saveSession]);

  const refreshEffectivePermissions = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) {
      setPermissionsBootstrap("idle");
      setPermissionsBootstrapError(null);
      return false;
    }

    setPermissionsBootstrap("loading");
    setPermissionsBootstrapError(null);

    try {
      const payload = await getEffectivePermissions();
      if (!Array.isArray(payload?.permissions)) {
        throw new Error("effective-permissions: payload invalide");
      }

      const latest = sessionRef.current;
      if (!latest?.user) {
        throw new Error("Session utilisateur absente après authentification.");
      }

      // Le snapshot SecureStore n'est jamais une autorité RBAC. Les permissions
      // live restent en mémoire et seront rechargées depuis PostgreSQL à chaque
      // restauration de session. Cela évite aussi un write SecureStore inutile.
      saveSession({
        ...latest,
        permissions: payload.permissions,
        user: {
          ...latest.user,
          permissions: payload.permissions,
        },
      });

      setPermissionsBootstrap("ready");
      return true;
    } catch (error) {
      safeLogger.warn("effective permissions bootstrap failed", error);

      if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
        await clearSecureSession().catch(() => undefined);
        clearAuthenticatedState();
        return false;
      }

      setPermissionsBootstrap("error");
      setPermissionsBootstrapError(permissionsBootstrapMessage(error));
      return false;
    }
  }, [clearAuthenticatedState, saveSession]);

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

        saveSession({
          role: profile.role as LoginResponse["role"],
          permissions: profile.permissions,
          user: profile.user as LoginResponse["user"],
          school: profile.school as LoginResponse["school"],
        });
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
