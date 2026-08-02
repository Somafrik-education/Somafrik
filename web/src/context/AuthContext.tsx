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

interface AuthContextValue {
  session: Session | null;
  isAuthenticated: boolean;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(loadStoredSession);
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

  useEffect(() => {
    const token = sessionRef.current?.accessToken;
    if (!token) return;
    let cancelled = false;
    void api.get("/backoffice/state").catch((err) => {
      if (cancelled) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setSession(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      return normalized;
    },
    [setSession],
  );

  const changePassword = useCallback(
    async (newPassword: string) => {
      const response = await api.post<{ user: Session["user"]; accessToken?: string }>(
        "/auth/change-password",
        {
          newPassword: newPassword.trim(),
        },
      );
      const current = sessionRef.current;
      if (current) {
        setSession({
          ...current,
          accessToken: response.accessToken ?? current.accessToken,
          user: { ...current.user, ...response.user, mustChangePassword: false },
        });
      }
    },
    [setSession],
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
    }
  }, [setSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session?.accessToken),
      login,
      logout,
      changePassword,
      setSession,
    }),
    [session, login, logout, changePassword, setSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
