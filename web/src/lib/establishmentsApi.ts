import { api, getAccessToken } from "../api/client";
import { API_URL } from "./apiUrl";
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
  /** Catalogue plateforme (Superadmin / Admin Pays). Interdit à SCHOOL_ADMIN. */
  list: () => api.get<School[]>("/backoffice/establishments"),

  /** Profil mono-tenant. SCHOOL_ADMIN : uniquement son membership. */
  get: (code: string) => api.get<School>(`/backoffice/establishments/${encodeURIComponent(code)}`),

  create: (payload: Partial<School>, force = false) =>
    api.post<{ school: School }>("/backoffice/establishments", { ...payload, force }),

  update: (code: string, payload: Partial<School>) =>
    api.patch<{ school: School }>(`/backoffice/establishments/${encodeURIComponent(code)}`, payload),

  uploadLogo: async (code: string, file: File) => {
    const token = getAccessToken();
    const response = await fetch(
      `${API_URL.replace(/\/$/, "")}/api/backoffice/establishments/${encodeURIComponent(code)}/logo`,
      {
        method: "PUT",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": file.name,
        },
        body: file,
      },
    );
    const data = (await response.json().catch(() => ({}))) as { message?: string; school?: School };
    if (!response.ok) {
      throw new Error(String(data.message ?? "Échec de l'upload du logo"));
    }
    return data;
  },

  removeLogo: (code: string) =>
    api.delete<{ school: School }>(`/backoffice/establishments/${encodeURIComponent(code)}/logo`),

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
