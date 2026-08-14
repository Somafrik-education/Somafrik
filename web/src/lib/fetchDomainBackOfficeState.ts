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

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** LOT 8 — composition client depuis les APIs métier (plus de GET /backoffice/state). */
export async function fetchDomainBackOfficeState(): Promise<Partial<BackOfficeState>> {
  const [
    schools,
    countries,
    subscriptions,
    notifications,
    rolePermissions,
    dashboardChartConfig,
    users,
    contacts,
    relations,
    messages,
    announcements,
    students,
    teachers,
    classes,
    courses,
    courseSchedules,
    assignments,
    payments,
    paymentStatuses,
    feeGrids,
    schoolFeeItems,
    notes,
    presences,
    academicConfig,
    planningExams,
    reportCards,
    establishmentDocuments,
  ] = await Promise.all([
    safe(() => establishmentsApi.list(), []),
    safe(() => platformApi.listCountries(), []),
    safe(() => platformApi.listSubscriptions(), []),
    safe(() => platformApi.listNotifications(), []),
    safe(() => platformApi.getRolePermissions(), {}),
    safe(() => platformApi.getDashboardChartConfig(), { platform: {}, establishment: {} }),
    safe(() => clientsApi.listUsers(), []),
    safe(() => clientsApi.listContacts(), []),
    safe(() => clientsApi.listRelations(), []),
    safe(() => clientsApi.listMessages(), []),
    safe(() => clientsApi.listAnnouncements(), []),
    safe(() => studentsApi.list(), []),
    safe(() => teachersApi.list(), []),
    safe(() => classesApi.list(), []),
    safe(() => pedagogyApi.listCourses(), []),
    safe(() => pedagogyApi.listCourseSchedules(), []),
    safe(() => api.get<unknown[]>("/assignments"), []),
    safe(() => financeApi.listPayments(), []),
    safe(() => financeApi.listPaymentStatuses(), []),
    safe(() => financeApi.listFeeGrids(), []),
    safe(() => financeApi.listStudentFees(), []),
    safe(() => api.get<unknown[]>("/notes"), []),
    safe(() => api.get<unknown[]>("/presences"), []),
    safe(() => api.get<Record<string, unknown>>("/academic-config"), null),
    safe(() => api.get<{ exams?: unknown[] }>("/backoffice/planning-exams"), { exams: [] }),
    safe(() => api.get<{ bulletins?: unknown[] }>("/backoffice/report-cards"), { bulletins: [] }),
    safe(
      () => api.get<{ documents?: unknown[] }>("/backoffice/establishment-documents"),
      { documents: [] },
    ),
  ]);

  const academicConfigs: Record<string, unknown> = {};
  const configSchoolCode = String(academicConfig?.schoolCode ?? "").trim();
  if (configSchoolCode) {
    academicConfigs[configSchoolCode] = academicConfig;
  }

  return {
    schools: schools as BackOfficeState["schools"],
    countries: countries as BackOfficeState["countries"],
    subscriptions: subscriptions as BackOfficeState["subscriptions"],
    notifications: notifications as BackOfficeState["notifications"],
    rolePermissions: rolePermissions as BackOfficeState["rolePermissions"],
    dashboardChartConfig: dashboardChartConfig as unknown as BackOfficeState["dashboardChartConfig"],
    users: users as BackOfficeState["users"],
    contacts: contacts as BackOfficeState["contacts"],
    relations: relations as BackOfficeState["relations"],
    messages: messages as BackOfficeState["messages"],
    announcements: announcements as BackOfficeState["announcements"],
    students: students as unknown as BackOfficeState["students"],
    teachers: teachers as BackOfficeState["teachers"],
    classes: classes as BackOfficeState["classes"],
    courses: courses as BackOfficeState["courses"],
    courseSchedules: courseSchedules as BackOfficeState["courseSchedules"],
    assignments: assignments as BackOfficeState["assignments"],
    payments: payments as BackOfficeState["payments"],
    paymentStatuses: paymentStatuses as BackOfficeState["paymentStatuses"],
    feeGrids: feeGrids as BackOfficeState["feeGrids"],
    studentFees: schoolFeeItems as BackOfficeState["studentFees"],
    notes: notes as BackOfficeState["notes"],
    presences: presences as BackOfficeState["presences"],
    academicConfigs: academicConfigs as BackOfficeState["academicConfigs"],
    exams: (planningExams.exams ?? []) as BackOfficeState["exams"],
    bulletins: (reportCards.bulletins ?? []) as BackOfficeState["bulletins"],
    documents: (establishmentDocuments.documents ?? []) as BackOfficeState["documents"],
  };
}
