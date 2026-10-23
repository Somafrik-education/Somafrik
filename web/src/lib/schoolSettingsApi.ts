import { api } from "../api/client";

export type SchoolSettings = {
  schoolId?: string;
  schoolCode: string;
  periodMode: "trimestre" | "semestre" | "periode" | string;
  defaultScale: number;
  reportCardMode: "period" | "annual" | "custom" | string;
  studentCardEnabled?: boolean;
  studentCardQrEnabled?: boolean;
  studentCardNfcEnabled?: boolean;
  studentCardAttendanceEnabled?: boolean;
  studentCardFinanceCheckEnabled?: boolean;
  /** CARTE-CYCLE-01 — titulaire explicite (null = non configuré) et surcharges par niveau d'enseignement. */
  studentCardHolderKind?: "eleve" | "etudiant" | null;
  studentCardHolderLevels?: Record<string, "eleve" | "etudiant">;
  /** Titulaire déduit du type d'établissement exact (null = type non déterminant). */
  studentCardHolderFromSchoolType?: "eleve" | "etudiant" | null;
  schoolYear?: string;
  periods?: Array<Record<string, unknown>>;
};

function scopedPath(schoolCode: string | undefined, suffix: string) {
  const scoped = String(schoolCode ?? "").trim();
  if (scoped && scoped !== "*") {
    return `/backoffice/establishments/${encodeURIComponent(scoped)}${suffix}`;
  }
  return suffix;
}

export const schoolSettingsApi = {
  get: (schoolCode?: string) => api.get<SchoolSettings>(scopedPath(schoolCode, "/school-settings")),
  patch: (payload: Record<string, unknown>, schoolCode?: string) =>
    api.patch<SchoolSettings>(scopedPath(schoolCode, "/school-settings"), payload),
  replacePeriods: (periods: Array<Record<string, unknown>>, schoolCode?: string) =>
    api.put<{ periods: Array<Record<string, unknown>>; periodMode: string }>(
      scopedPath(schoolCode, "/academic-periods"),
      { periods },
    ),
};
