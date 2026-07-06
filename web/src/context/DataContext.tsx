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
import { api } from "../api/client";
import { useAuth } from "./AuthContext";
import { SYNC_INTERVAL_MS } from "../lib/constants";
import { applyPartialSave, mergeRemoteSnapshot } from "../lib/backofficeStateMerge";
import { resolveEffectivePermissions } from "../lib/permissions";
import type { BackOfficeState, Session } from "../types";

interface DataContextValue {
  state: BackOfficeState;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  update: (patch: Partial<BackOfficeState>, options?: { sync?: boolean; partial?: boolean }) => Promise<void>;
}

const EMPTY_STATE: BackOfficeState = {
  schools: [],
  users: [],
  countries: [],
  contacts: [],
  relations: [],
  subscriptions: [],
  notifications: [],
  students: [],
  teachers: [],
  classes: [],
  courses: [],
  assignments: [],
  courseSchedules: [],
  payments: [],
  presences: [],
  notes: [],
  exams: [],
  bulletins: [],
  documents: [],
  announcements: [],
  messages: [],
  paymentStatuses: [],
  rolePermissions: {},
  academicConfigs: {},
  dashboardChartConfig: { platform: {}, establishment: {} },
  auditLog: [],
};

function stateFromSession(session: Session): BackOfficeState {
  return {
    ...EMPTY_STATE,
    schools: session.schools ?? [],
    users: session.users ?? [],
    countries: session.countries ?? [],
    subscriptions: session.subscriptions ?? [],
    notifications: session.notifications ?? [],
    rolePermissions: session.rolePermissions ?? {},
    academicConfigs: (session.academicConfigs as Record<string, unknown>) ?? {},
    auditLog: session.auditLog ?? [],
  };
}

function samePermissionSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((item) => values.has(item));
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { session, setSession } = useAuth();
  const [state, setState] = useState<BackOfficeState>(() =>
    session ? stateFromSession(session) : EMPTY_STATE,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const syncPausedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || syncPausedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const remote = await api.get<Partial<BackOfficeState>>("/backoffice/state");
      setState((prev) => mergeRemoteSnapshot(prev, remote));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      setState(stateFromSession(session));
      void refresh();
    } else {
      setState(EMPTY_STATE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

  // Rafraîchit la matrice de droits sans reconnexion (Super Admin → Admin établissement).
  useEffect(() => {
    if (!session?.accessToken) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [session?.accessToken, refresh]);

  useEffect(() => {
    if (!session?.user?.role || !session.accessToken) return;
    const merged = resolveEffectivePermissions(
      session.user.role,
      session.user.permissions,
      state.rolePermissions,
    );
    const current = session.permissions ?? session.user.permissions ?? [];
    if (samePermissionSet(current, merged)) return;
    setSession({
      ...session,
      permissions: merged,
      user: { ...session.user, permissions: merged },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rolePermissions, session?.accessToken, session?.user?.role, setSession]);

  const update = useCallback(
    async (patch: Partial<BackOfficeState>, options: { sync?: boolean; partial?: boolean } = {}) => {
      syncPausedRef.current = true;
      if (options.partial) {
        setState((prev) => ({ ...prev, ...patch }));
        if (options.sync === false) {
          syncPausedRef.current = false;
          return;
        }
        try {
          const saved = await api.put<Partial<BackOfficeState>>("/backoffice/state", patch);
          setState((prev) => applyPartialSave(prev, saved, patch));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Erreur de synchronisation");
          syncPausedRef.current = false;
          throw err;
        } finally {
          window.setTimeout(() => {
            syncPausedRef.current = false;
          }, 1500);
        }
        return;
      }

      const next = { ...stateRef.current, ...patch };
      setState(next);
      if (options.sync === false) {
        syncPausedRef.current = false;
        return;
      }
      try {
        const saved = await api.put<Partial<BackOfficeState>>("/backoffice/state", next);
        setState((prev) => mergeRemoteSnapshot(prev, saved));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de synchronisation");
        syncPausedRef.current = false;
        throw err;
      } finally {
        window.setTimeout(() => {
          syncPausedRef.current = false;
        }, 1500);
      }
    },
    [],
  );

  const value = useMemo<DataContextValue>(
    () => ({ state, loading, error, refresh, update }),
    [state, loading, error, refresh, update],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData doit être utilisé dans <DataProvider>");
  return ctx;
}
