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
import { useAuth } from "./AuthContext";
import { mergeRemoteSnapshot, purgeInactiveSchoolFromState } from "../lib/backofficeStateMerge";
import { SCHOOL_SCOPED_CANONICAL_KEYS } from "../lib/canonicalDomains";
import { assertNoStrippedCanonicalWrites } from "../lib/canonicalStateWriteGuard";
import { domainsFromPatch, domainCacheKey, loadDomains, type DomainKey } from "../lib/domainLoaders";
import { logDomainSync } from "../lib/domainSyncTelemetry";
import { getAccessToken } from "../api/client";
import { applyClientScopeToState, projectScopedUsers } from "../lib/scope";
import { logUserScopeTrace } from "../lib/schoolCanonicalIdentity";
import { stripClientFinanceFromPutPayload } from "../lib/stripClientFinance";
import { stripClientSchoolsFromPutPayload } from "../lib/stripClientSchools";
import { stripClientStudentsFromPutPayload } from "../lib/stripClientStudents";
import { stripClientPedagogyStaffFromPutPayload } from "../lib/stripClientPedagogyStaff";
import { stripClientPedagogyFromPutPayload } from "../lib/stripClientPedagogy";
import { stripClientPlatformFromPutPayload } from "../lib/stripClientPlatform";
import { stripClientClientsFromPutPayload } from "../lib/stripClientClients";
import {
  extractResidualPatch,
  hasResidualPatch,
  syncResidualBackOfficePatch,
} from "../lib/residualBackOfficeSync";
import {
  enqueuePatchMutations,
  formatOutboxFailureMessage,
  listActiveOutboxEntries,
  loadSyncOutbox,
  reapplyOutboxToState,
  saveSyncOutbox,
  settleOutboxAfterHttpSave,
  type SyncOutboxEntry,
} from "../lib/syncOutbox";
import type { BackOfficeState, Session } from "../types";

interface UpdateOptions {
  sync?: boolean;
  partial?: boolean;
  /** École cible pour la synchronisation résiduelle (configuration multi-établissement). */
  schoolCode?: string;
}

interface EnsureDomainsOptions {
  schoolCode?: string;
  force?: boolean;
}

interface DataContextValue {
  state: BackOfficeState;
  loading: boolean;
  error: string | null;
  /** Erreur de projection périmètre (identité canonique absente / mismatch / fuite). */
  scopeError: string | null;
  /** HOTFIX-SYNC-01 — journal des mutations non synchronisées. */
  syncJournal: SyncOutboxEntry[];
  /** Recharge les domaines déjà chargés, ou ceux passés en argument. */
  refresh: (domains?: DomainKey[], options?: EnsureDomainsOptions) => Promise<void>;
  /** Charge les domaines demandés s'ils ne le sont pas encore. */
  ensureDomains: (domains: DomainKey[], options?: EnsureDomainsOptions) => Promise<void>;
  /** Invalide le cache de domaines (ex. changement d'établissement actif). */
  invalidateDomains: (domains: DomainKey[], options?: EnsureDomainsOptions) => void;
  /** Purge les données scopées d'un établissement inactif (changement d'établissement). */
  purgeSchoolScopedState: (inactiveSchoolCode: string) => void;
  update: (patch: Partial<BackOfficeState>, options?: UpdateOptions) => Promise<void>;
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
    rolePermissions: session.rolePermissions ?? {},
    academicConfigs: (session.academicConfigs as Record<string, unknown>) ?? {},
    auditLog: session.auditLog ?? [],
  };
  return applyClientScopeToState(base, session.user);
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [state, setState] = useState<BackOfficeState>(() =>
    session ? stateFromSession(session) : EMPTY_STATE,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionUserRef = useRef(session?.user ?? null);
  sessionUserRef.current = session?.user ?? null;
  const loadedDomainsRef = useRef<Set<string>>(new Set());
  const activeSchoolCodeRef = useRef("");
  const domainFetchGenerationRef = useRef(new Map<string, number>());

  const rememberSchoolCode = useCallback((schoolCode?: string) => {
    const normalized = String(schoolCode ?? "").trim().toUpperCase();
    if (normalized && normalized !== "*") {
      activeSchoolCodeRef.current = normalized;
    }
  }, []);
  const syncPausedRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [syncJournal, setSyncJournal] = useState<SyncOutboxEntry[]>(() => listActiveOutboxEntries());

  const persistJournal = useCallback((entries: SyncOutboxEntry[]) => {
    saveSyncOutbox(entries);
    setSyncJournal(listActiveOutboxEntries(entries));
  }, []);

  const cacheKeysForDomains = useCallback((domains: DomainKey[], schoolCode?: string) => {
    return domains.map((domain) => domainCacheKey(domain, schoolCode));
  }, []);

  const mergeLoadedDomains = useCallback(
    (
      remote: Partial<BackOfficeState>,
      cacheKeys: string[],
      loadedKeys: DomainKey[],
      schoolCode?: string,
      expectedGenerations?: Map<string, number>,
    ) => {
      if (expectedGenerations) {
        for (const key of cacheKeys) {
          if (domainFetchGenerationRef.current.get(key) !== expectedGenerations.get(key)) {
            return false;
          }
        }
      }

      for (const key of cacheKeys) loadedDomainsRef.current.add(key);
      let nextScopeError: string | null | undefined;
      setState((prev) => {
        const merged = mergeRemoteSnapshot(prev, remote, {
          activeSchoolCode: schoolCode ?? activeSchoolCodeRef.current,
          loadedKeys,
        });
        logDomainSync("DOMAIN_SERVER_REPLACE", {
          domains: loadedKeys,
          schoolCode,
          count: loadedKeys.length,
        });
        const withPending = reapplyOutboxToState(merged, listActiveOutboxEntries());
        if (sessionUserRef.current && loadedKeys.includes("users")) {
          const projection = projectScopedUsers(sessionUserRef.current, withPending);
          nextScopeError = projection.error?.message ?? null;
          logUserScopeTrace(projection.trace);
        }
        return sessionUserRef.current
          ? applyClientScopeToState(withPending, sessionUserRef.current)
          : withPending;
      });
      if (nextScopeError !== undefined) {
        setScopeError(nextScopeError);
      }
      return true;
    },
    [],
  );

  const invalidateDomains = useCallback((domains: DomainKey[], options: EnsureDomainsOptions = {}) => {
    for (const domain of domains) {
      const cacheKey = domainCacheKey(domain, options.schoolCode);
      loadedDomainsRef.current.delete(cacheKey);
      logDomainSync("DOMAIN_INVALIDATED", { domain, schoolCode: options.schoolCode });
    }
  }, []);

  const purgeSchoolScopedState = useCallback((inactiveSchoolCode: string) => {
    const normalized = String(inactiveSchoolCode ?? "").trim().toUpperCase();
    if (!normalized || normalized === "*") return;
    setState((prev) => purgeInactiveSchoolFromState(prev, normalized));
    const domains = [...SCHOOL_SCOPED_CANONICAL_KEYS, "academicConfigs"] as DomainKey[];
    invalidateDomains(domains, { schoolCode: normalized });
  }, [invalidateDomains]);

  const refreshDomains = useCallback(
    async (domains?: DomainKey[], options: EnsureDomainsOptions = {}) => {
      if (!session || !getAccessToken() || syncPausedRef.current) return;
      const sessionMembership = String(session.user?.schoolCode ?? "").trim();
      const schoolCode =
        options.schoolCode ||
        activeSchoolCodeRef.current ||
        (sessionMembership && sessionMembership !== "*" ? sessionMembership : "");
      rememberSchoolCode(schoolCode);

      let keys = domains;
      if (!keys?.length) {
        keys = [...new Set(
          [...loadedDomainsRef.current].map((cacheKey) => cacheKey.split(":")[0] as DomainKey),
        )];
      }
      if (!keys.length) return;

      setLoading(true);
      try {
        const cacheKeys = cacheKeysForDomains(keys, schoolCode);
        const expectedGenerations = new Map<string, number>();
        for (const key of cacheKeys) {
          const nextGen = (domainFetchGenerationRef.current.get(key) ?? 0) + 1;
          domainFetchGenerationRef.current.set(key, nextGen);
          expectedGenerations.set(key, nextGen);
        }
        logDomainSync("DOMAIN_FETCH_START", { domains: keys, schoolCode });

        const result = await loadDomains(keys, { schoolCode, role: session.user?.role });
        if (result.loaded.length) {
          const applied = mergeLoadedDomains(
            result.data,
            cacheKeysForDomains(result.loaded, schoolCode),
            result.loaded,
            schoolCode,
            expectedGenerations,
          );
          if (applied) {
            logDomainSync("DOMAIN_FETCH_SUCCESS", { domains: result.loaded, schoolCode });
          }
        }
        if (result.serverErrors.length) {
          for (const entry of result.serverErrors) {
            logDomainSync("DOMAIN_FETCH_ERROR", { domain: entry.domain, error: entry.message });
          }
        }
        const failure = formatOutboxFailureMessage(loadSyncOutbox());
        const loadError = result.serverErrors.map((entry) => `${entry.domain}: ${entry.message}`).join(" ; ");
        setError(failure || loadError || null);
        if (result.serverErrors.length) {
          throw new Error(loadError);
        }
      } catch (err) {
        if (err instanceof Error && err.message) setError(err.message);
        else setError("Erreur de chargement");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [session, mergeLoadedDomains, cacheKeysForDomains, rememberSchoolCode],
  );

  const ensureDomains = useCallback(
    async (domains: DomainKey[], options: EnsureDomainsOptions = {}) => {
      if (!session || !getAccessToken()) return;
      const sessionMembership = String(session.user?.schoolCode ?? "").trim();
      const schoolCode =
        options.schoolCode ||
        activeSchoolCodeRef.current ||
        (sessionMembership && sessionMembership !== "*" ? sessionMembership : "");
      rememberSchoolCode(schoolCode);
      const pending = domains.filter((domain) => {
        const cacheKey = domainCacheKey(domain, schoolCode);
        if (options.force) return true;
        return !loadedDomainsRef.current.has(cacheKey);
      });
      if (!pending.length) return;
      if (options.force) {
        invalidateDomains(pending, { schoolCode });
      }
      await refreshDomains(pending, { schoolCode });
    },
    [session, refreshDomains, invalidateDomains, rememberSchoolCode],
  );

  useEffect(() => {
    if (session) {
      loadedDomainsRef.current = new Set();
      setScopeError(null);
      const seeded = reapplyOutboxToState(stateFromSession(session), listActiveOutboxEntries());
      setState(seeded);
    } else {
      loadedDomainsRef.current = new Set();
      setScopeError(null);
      setState(EMPTY_STATE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken]);

  const update = useCallback(
    async (patch: Partial<BackOfficeState>, options: UpdateOptions = {}) => {
      if (options.partial === false) {
        throw new Error("La restauration complète n'est pas disponible.");
      }
      if ("exams" in patch || "bulletins" in patch || "documents" in patch) {
        throw new Error(
          "Les examens, bulletins et documents ne sont plus enregistrables via le JSON résiduel. Utilisez les APIs canoniques.",
        );
      }

      const canonicalPatch = stripClientClientsFromPutPayload(
        stripClientPlatformFromPutPayload(
          stripClientPedagogyFromPutPayload(
            stripClientFinanceFromPutPayload(
              stripClientPedagogyStaffFromPutPayload(
                stripClientStudentsFromPutPayload(
                  stripClientSchoolsFromPutPayload(patch as Record<string, unknown>),
                ),
              ),
            ),
          ),
        ),
      ) as Partial<BackOfficeState>;
      assertNoStrippedCanonicalWrites(patch, canonicalPatch);
      if (Object.keys(canonicalPatch).length === 0) {
        return;
      }
      syncPausedRef.current = true;

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
        const residualPatch = extractResidualPatch(annotatedPatch as Partial<BackOfficeState>);
        if (!hasResidualPatch(residualPatch)) {
          workingOutbox = settleOutboxAfterHttpSave(workingOutbox, {
            ack: { accepted: [], rejected: [] },
            annotatedPatch,
          });
          persistJournal(workingOutbox);
          syncPausedRef.current = false;
          return;
        }

        const sessionSchool = String(sessionUserRef.current?.schoolCode ?? "").trim().toUpperCase();
        const targetSchool =
          String(options.schoolCode ?? sessionSchool).trim().toUpperCase() || sessionSchool;
        await syncResidualBackOfficePatch(residualPatch, targetSchool);

        const refreshKeys = domainsFromPatch(residualPatch);
        if (refreshKeys.length) {
          const targetSchool =
            String(options.schoolCode ?? sessionUserRef.current?.schoolCode ?? "").trim().toUpperCase() || undefined;
          const result = await loadDomains(refreshKeys, {
            schoolCode: targetSchool,
            role: sessionUserRef.current?.role,
          });
          if (result.loaded.length) {
            mergeLoadedDomains(
              result.data,
              cacheKeysForDomains(result.loaded, targetSchool),
              result.loaded,
              targetSchool,
            );
          }
        }

        workingOutbox = settleOutboxAfterHttpSave(workingOutbox, {
          ack: {
            accepted: Object.keys(residualPatch).map((entity) => ({ entity })),
            rejected: [],
          },
          annotatedPatch,
        });
        persistJournal(workingOutbox);

        const failure = formatOutboxFailureMessage(workingOutbox);
        setError(failure);
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
    [mergeLoadedDomains, persistJournal, cacheKeysForDomains],
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
    () => ({
      state,
      loading,
      error,
      scopeError,
      syncJournal,
      refresh: refreshDomains,
      ensureDomains,
      invalidateDomains,
      purgeSchoolScopedState,
      update,
      retryFailedSync,
    }),
    [state, loading, error, scopeError, syncJournal, refreshDomains, ensureDomains, invalidateDomains, purgeSchoolScopedState, update, retryFailedSync],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData doit être utilisé dans <DataProvider>");
  return ctx;
}
