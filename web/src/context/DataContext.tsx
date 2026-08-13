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
import { applyClientScopeToState } from "../lib/scope";
import { stripClientAuditLogFromPutPayload } from "../lib/stripClientAuditLog";
import { stripClientSchoolsFromPutPayload } from "../lib/stripClientSchools";
import { stripClientStudentsFromPutPayload } from "../lib/stripClientStudents";
import { stripClientPedagogyStaffFromPutPayload } from "../lib/stripClientPedagogyStaff";
import {
  enqueuePatchMutations,
  formatOutboxFailureMessage,
  listActiveOutboxEntries,
  loadSyncOutbox,
  reapplyOutboxToState,
  saveSyncOutbox,
  settleOutboxAfterHttpSave,
  type SyncAck,
  type SyncOutboxEntry,
} from "../lib/syncOutbox";
import type { BackOfficeState, Session } from "../types";

interface DataContextValue {
  state: BackOfficeState;
  loading: boolean;
  error: string | null;
  /** HOTFIX-SYNC-01 — journal des mutations non synchronisées. */
  syncJournal: SyncOutboxEntry[];
  refresh: () => Promise<void>;
  update: (patch: Partial<BackOfficeState>, options?: { sync?: boolean; partial?: boolean }) => Promise<void>;
  retryFailedSync: () => Promise<void>;
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
  evaluations: [],
  exams: [],
  bulletins: [],
  documents: [],
  announcements: [],
  messages: [],
  paymentStatuses: [],
  feeGrids: [],
  schoolFeeItems: [],
  studentFees: [],
  feeTariffHistory: [],
  rolePermissions: {},
  academicConfigs: {},
  dashboardChartConfig: { platform: {}, establishment: {} },
  auditLog: [],
};

function stateFromSession(session: Session): BackOfficeState {
  const base: BackOfficeState = {
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
  return applyClientScopeToState(base, session.user);
}

function samePermissionSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((item) => values.has(item));
}

function extractSyncAck(saved: Partial<BackOfficeState> & { syncAck?: SyncAck }): SyncAck | null {
  return saved.syncAck ?? null;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { session, setSession } = useAuth();
  const [state, setState] = useState<BackOfficeState>(() =>
    session ? stateFromSession(session) : EMPTY_STATE,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionUserRef = useRef(session?.user ?? null);
  sessionUserRef.current = session?.user ?? null;
  const syncPausedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncJournal, setSyncJournal] = useState<SyncOutboxEntry[]>(() => listActiveOutboxEntries());

  const persistJournal = useCallback((entries: SyncOutboxEntry[]) => {
    saveSyncOutbox(entries);
    setSyncJournal(listActiveOutboxEntries(entries));
  }, []);

  const refresh = useCallback(async () => {
    if (!session || syncPausedRef.current) return;
    setLoading(true);
    try {
      const remote = await api.get<Partial<BackOfficeState>>("/backoffice/state");
      const outbox = loadSyncOutbox();
      setState((prev) => {
        const merged = mergeRemoteSnapshot(prev, remote);
        const withPending = reapplyOutboxToState(merged, listActiveOutboxEntries(outbox));
        return session?.user ? applyClientScopeToState(withPending, session.user) : withPending;
      });
      const failure = formatOutboxFailureMessage(outbox);
      if (failure) setError(failure);
      else setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      const seeded = reapplyOutboxToState(stateFromSession(session), listActiveOutboxEntries());
      setState(seeded);
      void refresh();
    } else {
      setState(EMPTY_STATE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

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
      const usePartial = options.partial !== false;

      const canonicalPatch = stripClientPedagogyStaffFromPutPayload(
        patch as Record<string, unknown>,
      ) as Partial<BackOfficeState>;
      const currentOutbox = loadSyncOutbox();
      const { entries: enqueued, annotatedPatch } = enqueuePatchMutations(
        currentOutbox,
        canonicalPatch as Record<string, unknown>,
      );
      let workingOutbox = enqueued;
      persistJournal(workingOutbox);

      setState((prev) => {
        const next = { ...prev, ...(annotatedPatch as Partial<BackOfficeState>) };
        return reapplyOutboxToState(next, listActiveOutboxEntries(workingOutbox));
      });

      if (options.sync === false) {
        syncPausedRef.current = false;
        return;
      }

      workingOutbox = enqueued.map((entry) =>
        entry.status === "pending"
          ? {
              ...entry,
              status: "syncing" as const,
              attempts: entry.attempts + 1,
              updatedAt: new Date().toISOString(),
            }
          : entry,
      );
      persistJournal(workingOutbox);

      try {
        const rawPayload = usePartial
          ? (annotatedPatch as Partial<BackOfficeState>)
          : { ...stateRef.current, ...(annotatedPatch as Partial<BackOfficeState>) };
        // HOTFIX-RBAC-ADMIN-01 : jamais envoyer auditLog (non writable client → 403).
        const payload = stripClientPedagogyStaffFromPutPayload(
          stripClientStudentsFromPutPayload(
            stripClientSchoolsFromPutPayload(
              stripClientAuditLogFromPutPayload(rawPayload as Record<string, unknown>),
            ),
          ),
        ) as Partial<BackOfficeState>;
        const saved = await api.put<Partial<BackOfficeState> & { syncAck?: SyncAck }>(
          "/backoffice/state",
          payload,
        );
        const ack = extractSyncAck(saved);
        // ACK Notes explicite + ACK implicite des domaines snapshot BO (presences/exams/payments).
        workingOutbox = settleOutboxAfterHttpSave(workingOutbox, {
          ack,
          annotatedPatch,
        });
        persistJournal(workingOutbox);

        setState((prev) => {
          const base = usePartial
            ? applyPartialSave(prev, saved, annotatedPatch as Partial<BackOfficeState>)
            : mergeRemoteSnapshot(prev, saved);
          const withPending = reapplyOutboxToState(base, listActiveOutboxEntries(workingOutbox));
          return sessionUserRef.current
            ? applyClientScopeToState(withPending, sessionUserRef.current)
            : withPending;
        });

        const failure = formatOutboxFailureMessage(workingOutbox);
        setError(failure);
        // HOTFIX-SYNC-02 : un rejet métier (ex. rattachement) doit remonter à l'UI.
        if (failure) {
          syncPausedRef.current = false;
          throw new Error(failure);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur de synchronisation";
        workingOutbox = workingOutbox.map((entry) =>
          entry.status === "syncing"
            ? {
                ...entry,
                status: "failed" as const,
                lastError: message,
                updatedAt: new Date().toISOString(),
              }
            : entry,
        );
        persistJournal(workingOutbox);
        setState((prev) => reapplyOutboxToState(prev, listActiveOutboxEntries(workingOutbox)));
        setError(formatOutboxFailureMessage(workingOutbox) ?? message);
        syncPausedRef.current = false;
        throw err;
      } finally {
        window.setTimeout(() => {
          syncPausedRef.current = false;
        }, 1500);
      }
    },
    [persistJournal],
  );

  const retryFailedSync = useCallback(async () => {
    const failed = listActiveOutboxEntries().filter((entry) => entry.status === "failed");
    if (!failed.length) return;
    const patch: Partial<BackOfficeState> = {};
    for (const entry of failed) {
      const key = entry.entity as keyof BackOfficeState;
      const list = [...((patch[key] as Record<string, unknown>[] | undefined) ?? [])];
      list.push({
        ...entry.payload,
        id: entry.recordId,
        clientMutationId: entry.clientMutationId,
        syncStatus: "pending",
      });
      (patch as Record<string, unknown>)[entry.entity] = list;
    }
    await update(patch);
  }, [update]);

  const value = useMemo<DataContextValue>(
    () => ({ state, loading, error, syncJournal, refresh, update, retryFailedSync }),
    [state, loading, error, syncJournal, refresh, update, retryFailedSync],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData doit être utilisé dans <DataProvider>");
  return ctx;
}
