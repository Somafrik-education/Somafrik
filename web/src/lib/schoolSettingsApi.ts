import { api } from "../api/client";

export type SchoolSettings = {
  schoolId?: string;
  schoolCode: string;
  periodMode: "trimestre" | "semestre" | "periode" | string;
  defaultScale: number;
  reportCardMode: "period" | "annual" | "custom" | string;
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
