/**
 * Clients canoniques du lot Paramètres établissement Mobile.
 * Aucun PUT /academic-config. Aucune écriture outbox.
 */
import { unwrapList } from "../lib/dataTruth";
import { httpRequest } from "./httpClient";
import type { CanonicalEvaluationType, EducationSchoolCatalog } from "./api";

export type SchoolSettings = {
  schoolId?: string;
  schoolCode: string;
  periodMode: "trimestre" | "semestre" | "periode" | string;
  defaultScale: number;
  reportCardMode: "period" | "annual" | "custom" | string;
  schoolYear?: string;
  periods?: Array<Record<string, unknown>>;
};

export type AcademicYearRecord = {
  id: string;
  schoolCode?: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: string;
  isCurrent?: boolean;
};

export type EstablishmentProfileRecord = {
  code: string;
  name?: string;
  type?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  city?: string;
  principalName?: string;
  principalEmail?: string;
  principalPhone?: string;
  loginCode?: string;
};

export type AssignableEstablishmentRole = {
  id: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
};

function scopedPath(schoolCode: string | undefined, suffix: string) {
  const scoped = String(schoolCode ?? "").trim();
  if (scoped && scoped !== "*") {
    return `/backoffice/establishments/${encodeURIComponent(scoped)}${suffix}`;
  }
  return suffix;
}

export function getSchoolSettings(schoolCode?: string) {
  return httpRequest<SchoolSettings>(scopedPath(schoolCode, "/school-settings"));
}

export function patchSchoolSettings(payload: Record<string, unknown>, schoolCode?: string) {
  return httpRequest<SchoolSettings>(scopedPath(schoolCode, "/school-settings"), {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function replaceAcademicPeriods(periods: Array<Record<string, unknown>>, schoolCode?: string) {
  return httpRequest<{ periods: Array<Record<string, unknown>>; periodMode: string }>(
    scopedPath(schoolCode, "/academic-periods"),
    {
      method: "PUT",
      body: JSON.stringify({ periods }),
    },
  );
}

export function listAcademicYears() {
  return httpRequest<unknown>("/v2/academic-years").then((payload) => unwrapList(payload) as AcademicYearRecord[]);
}

export function createAcademicYear(payload: {
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}) {
  return httpRequest<AcademicYearRecord>("/v2/academic-years", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAcademicYear(
  id: string,
  payload: { name?: string; startDate?: string; endDate?: string; isCurrent?: boolean },
) {
  return httpRequest<AcademicYearRecord>(`/v2/academic-years/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function listEvaluationTypes(includeArchived = false) {
  const query = includeArchived ? "?includeArchived=true" : "";
  return httpRequest<{ types: CanonicalEvaluationType[] }>(`/evaluation-types${query}`);
}

export function createEvaluationType(payload: { name: string }) {
  return httpRequest<CanonicalEvaluationType>("/evaluation-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function archiveEvaluationType(typeId: string) {
  return httpRequest<CanonicalEvaluationType>(`/evaluation-types/${encodeURIComponent(typeId)}/archive`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function getEducationSchoolCatalog() {
  return httpRequest<EducationSchoolCatalog>("/education-reference/catalog");
}

export function saveSchoolEducationActivation(payload: {
  levelIds: string[];
  streamIds: string[];
  groupIds: string[];
}) {
  return httpRequest<EducationSchoolCatalog>("/education-reference/school-activation", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getEstablishmentProfile(code: string) {
  return httpRequest<EstablishmentProfileRecord>(`/backoffice/establishments/${encodeURIComponent(code)}`);
}

export function patchEstablishmentProfile(code: string, payload: Record<string, unknown>) {
  return httpRequest<{ school?: EstablishmentProfileRecord } | EstablishmentProfileRecord>(
    `/backoffice/establishments/${encodeURIComponent(code)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function listAssignableEstablishmentRoles() {
  return httpRequest<{ roles: AssignableEstablishmentRole[] }>("/establishment-roles/assignable");
}
