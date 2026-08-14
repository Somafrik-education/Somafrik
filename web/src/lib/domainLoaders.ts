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
  "presences",
  "academicConfigs",
  "exams",
  "bulletins",
  "documents",
] as const;

export type DomainKey = (typeof DOMAIN_KEYS)[number];

/** Domaines dont l'absence (400/403/404) est attendue pour certains rôles ou contextes. */
const OPTIONAL_DOMAIN_STATUSES = new Set([400, 403, 404]);

function isOptionalDomainError(error: unknown): boolean {
  return error instanceof ApiError && OPTIONAL_DOMAIN_STATUSES.has(error.status);
}

async function loadOptional<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isOptionalDomainError(error)) return fallback;
    throw error;
  }
}

type DomainSlice = Partial<Pick<BackOfficeState, DomainKey>>;

const DOMAIN_LOADERS: Record<DomainKey, () => Promise<DomainSlice>> = {
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
  assignments: async () => ({ assignments: (await api.get<unknown[]>("/assignments")) as BackOfficeState["assignments"] }),
  payments: async () => ({ payments: (await financeApi.listPayments()) as BackOfficeState["payments"] }),
  paymentStatuses: async () => ({
    paymentStatuses: (await financeApi.listPaymentStatuses()) as BackOfficeState["paymentStatuses"],
  }),
  feeGrids: async () => ({ feeGrids: (await financeApi.listFeeGrids()) as BackOfficeState["feeGrids"] }),
  studentFees: async () => ({
    studentFees: (await financeApi.listStudentFees()) as BackOfficeState["studentFees"],
  }),
  notes: async () => ({ notes: (await api.get<unknown[]>("/notes")) as BackOfficeState["notes"] }),
  presences: async () => ({ presences: (await api.get<unknown[]>("/presences")) as BackOfficeState["presences"] }),
  academicConfigs: async () => {
    const config = await loadOptional(
      () => api.get<Record<string, unknown>>("/academic-config"),
      null,
    );
    const schoolCode = String(config?.schoolCode ?? "").trim();
    return {
      academicConfigs: schoolCode
        ? ({ [schoolCode]: config } as BackOfficeState["academicConfigs"])
        : ({} as BackOfficeState["academicConfigs"]),
    };
  },
  exams: async () => {
    const payload = await loadOptional(
      () => api.get<{ exams?: unknown[] }>("/backoffice/planning-exams"),
      { exams: [] },
    );
    return { exams: (payload.exams ?? []) as BackOfficeState["exams"] };
  },
  bulletins: async () => {
    const payload = await loadOptional(
      () => api.get<{ bulletins?: unknown[] }>("/backoffice/report-cards"),
      { bulletins: [] },
    );
    return { bulletins: (payload.bulletins ?? []) as BackOfficeState["bulletins"] };
  },
  documents: async () => {
    const payload = await loadOptional(
      () => api.get<{ documents?: unknown[] }>("/backoffice/establishment-documents"),
      { documents: [] },
    );
    return { documents: (payload.documents ?? []) as BackOfficeState["documents"] };
  },
};

export async function loadDomains(keys: DomainKey[]): Promise<Partial<BackOfficeState>> {
  const unique = [...new Set(keys)];
  if (!unique.length) return {};

  const slices = await Promise.all(unique.map((key) => DOMAIN_LOADERS[key]()));
  return slices.reduce<Partial<BackOfficeState>>((acc, slice) => ({ ...acc, ...slice }), {});
}

export function domainsFromPatch(patch: Partial<BackOfficeState>): DomainKey[] {
  const keys: DomainKey[] = [];
  for (const key of DOMAIN_KEYS) {
    if (patch[key] !== undefined) keys.push(key);
  }
  return keys;
}
