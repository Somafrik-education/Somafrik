import { api } from "../api/client";
import type { School } from "../types";

export interface EstablishmentImportResult {
  created: School[];
  errors: { line: number; message: string; row: unknown }[];
  count: number;
}

export interface SubscriptionAccessInfo {
  schoolCode: string;
  level: "full" | "limited" | "readonly" | "blocked";
  lifecycle: string;
  daysLate: number;
  message: string;
  plan: string;
  paymentStatus: string;
}

export const establishmentsApi = {
  list: () => api.get<School[]>("/backoffice/establishments"),

  get: (code: string) => api.get<School>(`/backoffice/establishments/${encodeURIComponent(code)}`),

  create: (payload: Partial<School>, force = false) =>
    api.post<{ school: School }>("/backoffice/establishments", { ...payload, force }),

  update: (code: string, payload: Partial<School>) =>
    api.patch<{ school: School }>(`/backoffice/establishments/${encodeURIComponent(code)}`, payload),

  activate: (code: string) =>
    api.patch<{ school: School }>(`/backoffice/establishments/${encodeURIComponent(code)}/activate`, {}),

  suspend: (code: string) =>
    api.patch<{ school: School }>(`/backoffice/establishments/${encodeURIComponent(code)}/suspend`, {}),

  remove: (code: string) =>
    api.delete<{ school: School }>(`/backoffice/establishments/${encodeURIComponent(code)}`),

  importRows: (rows: Partial<School>[], force = false) =>
    api.post<EstablishmentImportResult>("/backoffice/establishments/import", { rows, force }),

  getSubscription: (code: string) =>
    api.get<Record<string, unknown>>(`/backoffice/establishments/${encodeURIComponent(code)}/subscription`),

  getSubscriptionAccess: (schoolCode?: string) =>
    api.get<SubscriptionAccessInfo>(
      `/backoffice/subscription-access${schoolCode ? `?schoolCode=${encodeURIComponent(schoolCode)}` : ""}`,
    ),
};
