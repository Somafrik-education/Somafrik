import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  LoginResponse,
  hasActiveAccessToken,
  logout as logoutSession,
  persistAuthenticatedSession,
} from "../services/api";
import { enrichSessionPermissions } from "../domain/security/permissions";
import { setSessionExpiredHandler } from "../services/httpClient";
import { clearSecureSession, getSessionProfile } from "../services/secureStorage";
import { safeLogger } from "../services/safeLogger";

type AuthContextValue = {
  session: LoginResponse | null;
  selectedStudentId: string | null;
  bootstrapping: boolean;
  setSession: (session: LoginResponse | null) => void;
  setSelectedStudentId: (studentId: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function stripSecrets(session: LoginResponse | null): LoginResponse | null {
  if (!session) return null;
  const { accessToken: _a, refreshToken: _r, ...rest } = session;
  return rest;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<LoginResponse | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const saveSession = (nextSession: LoginResponse | null) => {
    const enriched = enrichSessionPermissions(stripSecrets(nextSession));
    setSessionState(enriched);
    setSelectedStudentId(enriched?.user.children?.[0]?.id ?? enriched?.user.id ?? null);
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const hasToken = await hasActiveAccessToken();
        if (!hasToken) return;
        const profile = await getSessionProfile();
        if (!mounted || !profile) return;
        saveSession({
          role: profile.role as LoginResponse["role"],
          permissions: profile.permissions,
          user: profile.user as LoginResponse["user"],
          school: profile.school as LoginResponse["school"],
        });
      } catch (error) {
        safeLogger.warn("session restore failed", error);
        await clearSecureSession();
      } finally {
        if (mounted) setBootstrapping(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      saveSession(null);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      selectedStudentId,
      bootstrapping,
      setSession: (next: LoginResponse | null) => {
        // Tokens already persisted by login/persistAuthenticatedSession when present.
        if (next?.accessToken || next?.refreshToken) {
          void persistAuthenticatedSession(next).then((safe) => saveSession(safe));
          return;
        }
        saveSession(next);
      },
      setSelectedStudentId,
      logout: () => {
        void logoutSession().catch(() => undefined);
        saveSession(null);
      },
    }),
    [session, selectedStudentId, bootstrapping],
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
