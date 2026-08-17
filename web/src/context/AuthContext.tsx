import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, setAccessTokenProvider } from "../api/client";
import { normalizePlatformRole } from "../lib/orgHierarchy";
import type { LoginProfile, Session } from "../types";

interface LoginInput {
  identifier: string;
  password: string;
  schoolCode?: string;
  profile: LoginProfile;
}

export type PermissionsBootstrap = "idle" | "loading" | "ready" | "error";

interface AuthContextValue {
  session: Session | null;
  isAuthenticated: boolean;
  permissionsReady: boolean;
  permissionsBootstrap: PermissionsBootstrap;
  permissionsBootstrapError: string | null;
  login: (input: LoginInput) => Promise<Session>;
  logout: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  setSession: (session: Session | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "somafrik.web.session";

function loadStoredSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function logPermissionsBootstrapFailure(err: unknown) {
  const status = err instanceof ApiError ? err.status : undefined;
  const message = err instanceof Error ? err.message : "unknown";
  console.error(
    JSON.stringify({
      kind: "effective_permissions_bootstrap_failure",
      status: status ?? null,
      message,
    }),
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(loadStoredSession);
  const [permissionsBootstrap, setPermissionsBootstrap] = useState<PermissionsBootstrap>(
    session?.accessToken ? "loading" : "idle",
  );
  const [permissionsBootstrapError, setPermissionsBootstrapError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(session);

  const setSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSessionState(next);
    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* stockage indisponible: on continue en mémoire */
    }
  }, []);

  useEffect(() => {
    setAccessTokenProvider(() => sessionRef.current?.accessToken ?? null);
  }, []);

  const hydrateEffectivePermissions = useCallback(async () => {
    const current = sessionRef.current;
    if (!current?.accessToken) {
      setPermissionsBootstrap("idle");
      setPermissionsBootstrapError(null);
      return current;
    }
    setPermissionsBootstrap("loading");
    setPermissionsBootstrapError(null);
    try {
      const payload = await api.get<{ permissions?: string[] }>("/auth/effective-permissions");
      if (!Array.isArray(payload?.permissions)) {
        throw new Error("effective-permissions: payload invalide");
      }
      const latest = sessionRef.current;
      if (!latest?.user) {
        setPermissionsBootstrap("error");
        setPermissionsBootstrapError("Session utilisateur absente après login.");
        return latest;
      }
      const next: Session = {
        ...latest,
        permissions: payload.permissions,
        user: { ...latest.user, permissions: payload.permissions },
      };
      setSession(next);
      setPermissionsBootstrap("ready");
      return next;
    } catch (err) {
      logPermissionsBootstrapFailure(err);
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setSession(null);
        setPermissionsBootstrap("idle");
        setPermissionsBootstrapError(null);
        return null;
      }
      setPermissionsBootstrap("error");
      setPermissionsBootstrapError(
        err instanceof Error ? err.message : "Impossible de charger les permissions effectives.",
      );
      return sessionRef.current;
    }
  }, [setSession]);

  useEffect(() => {
    if (!session?.accessToken) {
      setPermissionsBootstrap("idle");
      setPermissionsBootstrapError(null);
      return;
    }
    let cancelled = false;
    void hydrateEffectivePermissions().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken, hydrateEffectivePermissions]);

  const login = useCallback(
    async ({ identifier, password, schoolCode, profile }: LoginInput) => {
      if (profile === "school" && !schoolCode) {
        throw new Error("Le code établissement est obligatoire pour un compte établissement.");
      }
      const payload = {
        identifier: identifier.trim(),
        password: password.trim(),
        ...(schoolCode ? { schoolCode: schoolCode.trim().toUpperCase() } : {}),
      };
      const response = await api.post<Session>("/backoffice/login", payload);
      const normalized: Session = {
        ...response,
        user: response.user
          ? { ...response.user, role: normalizePlatformRole(response.user.role) }
          : response.user,
      };
      setSession(normalized);
      const live = await hydrateEffectivePermissions();
      return live ?? normalized;
    },
    [setSession, hydrateEffectivePermissions],
  );

  const changePassword = useCallback(
    async (newPassword: string) => {
      const response = await api.post<{ user: Session["user"]; accessToken?: string }>("/auth/change-password", {
        newPassword: newPassword.trim(),
      });
      const current = sessionRef.current;
      if (current) {
        setSession({
          ...current,
          accessToken: response.accessToken ?? current.accessToken,
          user: { ...current.user, ...response.user, mustChangePassword: false },
        });
        await hydrateEffectivePermissions();
      }
    },
    [setSession, hydrateEffectivePermissions],
  );

  const logout = useCallback(async () => {
    try {
      if (sessionRef.current?.accessToken) {
        await api.post("/auth/logout");
      }
    } catch {
      // La session locale doit toujours être fermée, même si l'API est indisponible.
    } finally {
      setSession(null);
      setPermissionsBootstrap("idle");
      setPermissionsBootstrapError(null);
    }
  }, [setSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session?.accessToken),
      permissionsReady: permissionsBootstrap === "ready",
      permissionsBootstrap,
      permissionsBootstrapError,
      login,
      logout,
      changePassword,
      setSession,
    }),
    [
      session,
      permissionsBootstrap,
      permissionsBootstrapError,
      login,
      logout,
      changePassword,
      setSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
