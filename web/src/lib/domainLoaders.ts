import { ApiError } from "../api/client";
import { api } from "../api/client";
import { clientsApi } from "./clientsApi";
import { classesApi } from "./classesApi";
import { establishmentsApi } from "./establishmentsApi";
import { financeApi } from "./financeApi";
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
}

export interface LoadDomainsResult {
  data: Partial<BackOfficeState>;
  loaded: DomainKey[];
  skipped: DomainKey[];
  serverErrors: { domain: DomainKey; message: string }[];
}

type DomainSlice = Partial<Pick<BackOfficeState, DomainKey>>;

function academicConfigPath(schoolCode?: string): string {
  const scopedSchool = String(schoolCode ?? "").trim().toUpperCase();
  if (scopedSchool && scopedSchool !== "*") {
    return `/backoffice/establishments/${encodeURIComponent(scopedSchool)}/academic-config`;
  }
  return "/academic-config";
}

function createDomainLoaders(options: LoadDomainsOptions = {}): Record<DomainKey, () => Promise<DomainSlice>> {
  return {
    schools: async () => ({ schools: (await establishmentsApi.list()) as BackOfficeState["schools"] }),
    countries: async () => ({ countries: (await platformApi.listCountries()) as BackOfficeState["countries"] }),
    subscriptions: async () => ({
      subscriptions: (await platformApi.listSubscriptions()) as BackOfficeState["subscriptions"],
    }),
    notifications: async () => ({
      notifications: (await platformApi.listNotifications()) as BackOfficeState["notifications"],
    }),
    rolePermissions: async () => ({
      rolePermissions: (await platformApi.getRolePermissions()) as BackOfficeState["rolePermissions"],
    }),
    dashboardChartConfig: async () => ({
      dashboardChartConfig: (await platformApi.getDashboardChartConfig()) as unknown as BackOfficeState["dashboardChartConfig"],
    }),
    users: async () => ({ users: (await clientsApi.listUsers()) as BackOfficeState["users"] }),
    contacts: async () => ({ contacts: (await clientsApi.listContacts()) as BackOfficeState["contacts"] }),
    relations: async () => ({ relations: (await clientsApi.listRelations()) as BackOfficeState["relations"] }),
    messages: async () => ({ messages: (await clientsApi.listMessages()) as BackOfficeState["messages"] }),
    announcements: async () => ({
      announcements: (await clientsApi.listAnnouncements()) as BackOfficeState["announcements"],
    }),
    students: async () => ({ students: (await studentsApi.list()) as unknown as BackOfficeState["students"] }),
    teachers: async () => ({ teachers: (await teachersApi.list()) as BackOfficeState["teachers"] }),
    classes: async () => ({ classes: (await classesApi.list()) as BackOfficeState["classes"] }),
    courses: async () => ({ courses: (await pedagogyApi.listCourses()) as BackOfficeState["courses"] }),
    courseSchedules: async () => ({
      courseSchedules: (await pedagogyApi.listCourseSchedules()) as BackOfficeState["courseSchedules"],
    }),
    assignments: async () => ({
      assignments: (await api.get<unknown[]>("/assignments")) as BackOfficeState["assignments"],
    }),
    payments: async () => ({ payments: (await financeApi.listPayments()) as BackOfficeState["payments"] }),
    paymentStatuses: async () => ({
      paymentStatuses: (await financeApi.listPaymentStatuses()) as BackOfficeState["paymentStatuses"],
    }),
    feeGrids: async () => ({ feeGrids: (await financeApi.listFeeGrids()) as BackOfficeState["feeGrids"] }),
    studentFees: async () => ({
      studentFees: (await financeApi.listStudentFees()) as BackOfficeState["studentFees"],
    }),
    notes: async () => ({ notes: (await api.get<unknown[]>("/notes")) as BackOfficeState["notes"] }),
    evaluations: async () => ({
      evaluations: (await pedagogyApi.listEvaluations()) as BackOfficeState["evaluations"],
    }),
    presences: async () => ({ presences: (await api.get<unknown[]>("/presences")) as BackOfficeState["presences"] }),
    academicConfigs: async () => {
      const config = await api.get<Record<string, unknown>>(academicConfigPath(options.schoolCode));
      const schoolCode = String(config?.schoolCode ?? options.schoolCode ?? "").trim();
      return {
        academicConfigs: schoolCode
          ? ({ [schoolCode]: config } as BackOfficeState["academicConfigs"])
          : ({} as BackOfficeState["academicConfigs"]),
      };
    },
    exams: async () => {
      const payload = await api.get<{ exams?: unknown[] }>("/exams");
      return { exams: (payload.exams ?? []) as BackOfficeState["exams"] };
    },
    bulletins: async () => {
      const payload = await api.get<{ bulletins?: unknown[] }>("/report-cards");
      return { bulletins: (payload.bulletins ?? []) as BackOfficeState["bulletins"] };
    },
    documents: async () => {
      const payload = await api.get<{ documents?: unknown[] }>("/school-documents");
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

export async function loadDomains(
  keys: DomainKey[],
  options: LoadDomainsOptions = {},
): Promise<LoadDomainsResult> {
  const unique = [...new Set(keys)];
  if (!unique.length) {
    return { data: {}, loaded: [], skipped: [], serverErrors: [] };
  }

  const loaders = createDomainLoaders(options);
  const results = await Promise.allSettled(
    unique.map(async (domain) => ({ domain, slice: await loaders[domain]() })),
  );

  const data: Partial<BackOfficeState> = {};
  const loaded: DomainKey[] = [];
  const skipped: DomainKey[] = [];
  const serverErrors: { domain: DomainKey; message: string }[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const domain = unique[index];
    const result = results[index];
    if (result.status === "fulfilled") {
      Object.assign(data, result.value.slice);
      loaded.push(domain);
      continue;
    }

    const error = result.reason;
    if (error instanceof ApiError) {
      if (error.status === 401) throw error;
      if (error.status === 403 || error.status === 404) {
        skipped.push(domain);
        continue;
      }
      serverErrors.push({ domain, message: error.message });
      continue;
    }

    const message = error instanceof Error ? error.message : "Erreur de chargement";
    serverErrors.push({ domain, message });
  }

  return { data, loaded, skipped, serverErrors };
}

export function domainsFromPatch(patch: Partial<BackOfficeState>): DomainKey[] {
  const keys: DomainKey[] = [];
  for (const key of DOMAIN_KEYS) {
    if (patch[key] !== undefined) keys.push(key);
  }
  return keys;
}
