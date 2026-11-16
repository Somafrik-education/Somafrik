import { ApiError, api, getAccessToken, type RequestArgs, type RequestOptions } from "../api/client";
import { httpErrorKind, isAbortedRequest } from "./httpErrorKinds";
import { clientsApi } from "./clientsApi";
import { classesApi } from "./classesApi";
import { establishmentsApi } from "./establishmentsApi";
import { financeApi } from "./financeApi";
import { isInternalSchoolRole } from "./format";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";
import { pedagogyApi } from "./pedagogyApi";
import { platformApi } from "./platformApi";
import { studentsApi } from "./studentsApi";
import { teachersApi } from "./teachersApi";
import type { BackOfficeState } from "../types";

export const DOMAIN_KEYS = [
  "schools",
  "countries",
  "subscriptions",
  "notifications",
  "rolePermissions",
  "dashboardChartConfig",
  "users",
  "contacts",
  "relations",
  "messages",
  "announcements",
  "students",
  "teachers",
  "classes",
  "courses",
  "courseSchedules",
  "assignments",
  "payments",
  "paymentStatuses",
  "feeGrids",
  "schoolFeeItems",
  "studentFees",
  "notes",
  "evaluations",
  "presences",
  "academicConfigs",
  "exams",
  "bulletins",
  "documents",
] as const;

export type DomainKey = (typeof DOMAIN_KEYS)[number];

export interface LoadDomainsOptions {
  schoolCode?: string;
  /** Rôle session : le catalogue schools se décide sur le rôle, pas sur schoolCode. */
  role?: string;
}

/** Superadmin / Admin Pays : toujours GET /establishments (liste). */
export function usesPlatformSchoolCatalog(role?: string): boolean {
  return isSuperAdminRole(role) || role === COUNTRY_ADMIN_ROLE;
}

export interface LoadDomainsResult {
  data: Partial<BackOfficeState>;
  loaded: DomainKey[];
  skipped: DomainKey[];
  serverErrors: DomainLoadError[];
  /** PERF-PR4 : domaines annulés volontairement (aucune donnée, aucune erreur visible). */
  aborted: DomainKey[];
}

export type DomainLoadError = {
  domain: DomainKey;
  message: string;
  status?: number;
  /** http | network | timeout : nature de l'échec, pour l'affichage et le réessai. */
  kind?: "http" | "network" | "timeout" | "unknown";
};

/** Issue d'un domaine, signalée dès qu'il se termine (chargement progressif). */
export type DomainOutcome =
  | { domain: DomainKey; status: "loaded"; slice: Partial<BackOfficeState> }
  | { domain: DomainKey; status: "skipped" }
  | { domain: DomainKey; status: "aborted" }
  | { domain: DomainKey; status: "error"; error: DomainLoadError };

export interface LoadDomainsRuntime {
  /** Annule toutes les lectures du lot (déconnexion, changement d'établissement). */
  signal?: AbortSignal;
  /** Appelé dès qu'un domaine se termine, avant la fin du plus lent. */
  onDomain?: (outcome: DomainOutcome) => void;
}

/**
 * Domaines d'historique volumineux (PERF-PR3 : jusqu'à ~8 Mio compressés pour une école
 * de 500 élèves) : délai de lecture explicite plus long que le défaut de 20 s.
 */
export const HEAVY_DOMAIN_TIMEOUT_MS = 60_000;
const HEAVY_DOMAINS = new Set<DomainKey>(["presences", "notes", "payments", "studentFees", "bulletins"]);

export function domainRequestTimeout(domain: DomainKey): number | undefined {
  return HEAVY_DOMAINS.has(domain) ? HEAVY_DOMAIN_TIMEOUT_MS : undefined;
}

type DomainSlice = Partial<Pick<BackOfficeState, DomainKey>>;

function hasConcreteSchool(schoolCode?: string): boolean {
  const scopedSchool = String(schoolCode ?? "").trim();
  return Boolean(scopedSchool && scopedSchool !== "*");
}

function academicConfigPath(schoolCode?: string): string {
  const scopedSchool = String(schoolCode ?? "").trim().toUpperCase();
  if (scopedSchool && scopedSchool !== "*") {
    return `/backoffice/establishments/${encodeURIComponent(scopedSchool)}/academic-config`;
  }
  return "/academic-config";
}

type DomainLoader = (...init: RequestArgs) => Promise<DomainSlice>;

function createDomainLoaders(options: LoadDomainsOptions = {}): Record<DomainKey, DomainLoader> {
  return {
    schools: async (...init) => {
      if (usesPlatformSchoolCatalog(options.role) || !options.role) {
        return { schools: (await establishmentsApi.list(...init)) as BackOfficeState["schools"] };
      }
      const scoped = String(options.schoolCode ?? "").trim();
      if (isInternalSchoolRole(options.role) && scoped && scoped !== "*") {
        const school = await establishmentsApi.get(scoped, ...init);
        return { schools: school ? [school] : [] };
      }
      return { schools: [] };
    },
    countries: async (...init) => ({ countries: (await platformApi.listCountries(...init)) as BackOfficeState["countries"] }),
    subscriptions: async (...init) => ({
      subscriptions: (await platformApi.listSubscriptions(...init)) as BackOfficeState["subscriptions"],
    }),
    notifications: async (...init) => ({
      notifications: (await platformApi.listNotifications(...init)) as BackOfficeState["notifications"],
    }),
    rolePermissions: async (...init) => ({
      rolePermissions: (await platformApi.getRolePermissions(...init)) as BackOfficeState["rolePermissions"],
    }),
    dashboardChartConfig: async (...init) => ({
      dashboardChartConfig: (await platformApi.getDashboardChartConfig(...init)) as unknown as BackOfficeState["dashboardChartConfig"],
    }),
    users: async (...init) => ({ users: (await clientsApi.listUsers(...init)) as BackOfficeState["users"] }),
    contacts: async (...init) => ({ contacts: (await clientsApi.listContacts(...init)) as BackOfficeState["contacts"] }),
    relations: async (...init) => ({ relations: (await clientsApi.listRelations(...init)) as BackOfficeState["relations"] }),
    messages: async (...init) => ({ messages: (await clientsApi.listMessages(...init)) as BackOfficeState["messages"] }),
    announcements: async (...init) => ({
      announcements: (await clientsApi.listAnnouncements(...init)) as BackOfficeState["announcements"],
    }),
    students: async (...init) => ({ students: (await studentsApi.list(...init)) as unknown as BackOfficeState["students"] }),
    teachers: async (...init) => ({
      // teachersApi.list() reste sans paramètre (contrat PARITY-028) : options passées à api.get.
      teachers: (init.length
        ? await api.get<unknown[]>("/teachers", init[0])
        : await teachersApi.list()) as BackOfficeState["teachers"],
    }),
    classes: async (...init) => ({ classes: (await classesApi.list(...init)) as BackOfficeState["classes"] }),
    courses: async (...init) => ({ courses: (await pedagogyApi.listCourses(...init)) as BackOfficeState["courses"] }),
    courseSchedules: async (...init) => ({
      courseSchedules: (await pedagogyApi.listCourseSchedules(...init)) as BackOfficeState["courseSchedules"],
    }),
    assignments: async (...init) => ({
      assignments: (await api.get<unknown[]>("/assignments", ...init)) as BackOfficeState["assignments"],
    }),
    payments: async (...init) => ({ payments: (await financeApi.listPayments(...init)) as BackOfficeState["payments"] }),
    paymentStatuses: async (...init) => ({
      paymentStatuses: (await financeApi.listPaymentStatuses(...init)) as BackOfficeState["paymentStatuses"],
    }),
    feeGrids: async (...init) => ({ feeGrids: (await financeApi.listFeeGrids(...init)) as BackOfficeState["feeGrids"] }),
    schoolFeeItems: async (...init) => ({
      schoolFeeItems: (await financeApi.listSchoolFeeItems(...init)) as BackOfficeState["schoolFeeItems"],
    }),
    studentFees: async (...init) => ({
      studentFees: (await (init.length ? financeApi.listStudentFees(undefined, ...init) : financeApi.listStudentFees())) as BackOfficeState["studentFees"],
    }),
    notes: async (...init) => ({ notes: (await api.get<unknown[]>("/notes", ...init)) as BackOfficeState["notes"] }),
    evaluations: async (...init) => ({
      // pedagogyApi.listEvaluations() reste sans paramètre (contrat verify-teacher-login-scope).
      evaluations: (init.length
        ? await api.get<unknown[]>("/evaluations", init[0])
        : await pedagogyApi.listEvaluations()) as BackOfficeState["evaluations"],
    }),
    presences: async (...init) => ({ presences: (await api.get<unknown[]>("/presences", ...init)) as BackOfficeState["presences"] }),
    academicConfigs: async (...init) => {
      // BULLETIN-PREPROD-01 : un compte plateforme (Superadmin, Admin Pays) sans
      // établissement sélectionné n'a pas de configuration académique. L'API
      // non ciblée refuse alors l'appel (400 « schoolCode établissement requis »),
      // à juste titre : on n'interroge pas le serveur et on n'attribue aucun
      // établissement par défaut. Établissement sélectionné : chargement normal.
      if (!hasConcreteSchool(options.schoolCode) && usesPlatformSchoolCatalog(options.role)) {
        return { academicConfigs: {} as BackOfficeState["academicConfigs"] };
      }
      const config = await api.get<Record<string, unknown>>(academicConfigPath(options.schoolCode), ...init);
      const schoolCode = String(config?.schoolCode ?? options.schoolCode ?? "").trim();
      return {
        academicConfigs: schoolCode
          ? ({ [schoolCode]: config } as BackOfficeState["academicConfigs"])
          : ({} as BackOfficeState["academicConfigs"]),
      };
    },
    exams: async (...init) => {
      const payload = await api.get<{ exams?: unknown[] }>("/exams", ...init);
      return { exams: (payload.exams ?? []) as BackOfficeState["exams"] };
    },
    bulletins: async (...init) => {
      const payload = await api.get<{ bulletins?: unknown[] }>("/report-cards", ...init);
      return { bulletins: (payload.bulletins ?? []) as BackOfficeState["bulletins"] };
    },
    documents: async (...init) => {
      const payload = await api.get<{ documents?: unknown[] }>("/school-documents", ...init);
      return { documents: (payload.documents ?? []) as BackOfficeState["documents"] };
    },
  };
}

export function domainCacheKey(domain: DomainKey, schoolCode?: string): string {
  if (domain === "academicConfigs") {
    const scopedSchool = String(schoolCode ?? "").trim().toUpperCase();
    return scopedSchool && scopedSchool !== "*" ? `academicConfigs:${scopedSchool}` : "academicConfigs";
  }
  return domain;
}

function classifyDomainError(domain: DomainKey, error: unknown): DomainOutcome {
  if (isAbortedRequest(error)) return { domain, status: "aborted" };
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        domain,
        status: "error",
        error: {
          domain,
          status: error.status,
          kind: "http",
          message:
            error.status === 401
              ? `${domain}: session expirée. Reconnectez-vous.`
              : `${domain}: accès refusé pour ce domaine.`,
        },
      };
    }
    if (error.status === 404) return { domain, status: "skipped" };
    return { domain, status: "error", error: { domain, status: error.status, kind: "http", message: error.message } };
  }
  const detected = httpErrorKind(error);
  const kind = detected === "timeout" || detected === "network" ? detected : "unknown";
  const message = error instanceof Error ? error.message : "Erreur de chargement";
  return { domain, status: "error", error: { domain, kind, message } };
}

/**
 * Charge les domaines en parallèle. Chaque domaine est signalé à `onDomain` dès sa fin
 * (fusion progressive) ; la promesse, elle, attend toujours tous les domaines.
 */
export async function loadDomains(
  keys: DomainKey[],
  options: LoadDomainsOptions = {},
  runtime: LoadDomainsRuntime = {},
): Promise<LoadDomainsResult> {
  const unique = [...new Set(keys)];
  if (!unique.length) {
    return { data: {}, loaded: [], skipped: [], serverErrors: [], aborted: [] };
  }

  if (!getAccessToken()) {
    return {
      data: {},
      loaded: [],
      skipped: [],
      aborted: [],
      serverErrors: unique.map((domain) => ({
        domain,
        message: `${domain}: accessToken absent — aucun fetch métier avant session prête.`,
      })),
    };
  }

  const loaders = createDomainLoaders(options);
  const outcomes = await Promise.all(
    unique.map(async (domain): Promise<DomainOutcome> => {
      let outcome: DomainOutcome;
      try {
        // Sans signal ni délai propre, l'appel reste identique à l'historique (aucun argument).
        const init: RequestOptions = {};
        if (runtime.signal) init.signal = runtime.signal;
        const timeoutMs = domainRequestTimeout(domain);
        if (timeoutMs) init.timeoutMs = timeoutMs;
        const args: RequestArgs = Object.keys(init).length ? [init] : [];
        outcome = { domain, status: "loaded", slice: await loaders[domain](...args) };
      } catch (error) {
        outcome = classifyDomainError(domain, error);
      }
      runtime.onDomain?.(outcome);
      return outcome;
    }),
  );

  const data: Partial<BackOfficeState> = {};
  const loaded: DomainKey[] = [];
  const skipped: DomainKey[] = [];
  const aborted: DomainKey[] = [];
  const serverErrors: DomainLoadError[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "loaded") {
      Object.assign(data, outcome.slice);
      loaded.push(outcome.domain);
    } else if (outcome.status === "skipped") skipped.push(outcome.domain);
    else if (outcome.status === "aborted") aborted.push(outcome.domain);
    else serverErrors.push(outcome.error);
  }

  return { data, loaded, skipped, serverErrors, aborted };
}

export function domainsFromPatch(patch: Partial<BackOfficeState>): DomainKey[] {
  const keys: DomainKey[] = [];
  for (const key of DOMAIN_KEYS) {
    if (patch[key] !== undefined) keys.push(key);
  }
  return keys;
}
