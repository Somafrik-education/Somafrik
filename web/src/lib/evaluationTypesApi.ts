import { api } from "../api/client";

export type CanonicalEvaluationType = {
  id: string;
  schoolCode: string;
  code: string;
  name: string;
  displayOrder: number;
  status: "active" | "archived";
};

export const evaluationTypesApi = {
  list: (options?: { schoolCode?: string; includeArchived?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.includeArchived) params.set("includeArchived", "true");
    const query = params.toString();
    const path = options?.schoolCode
      ? `/backoffice/establishments/${encodeURIComponent(options.schoolCode)}/evaluation-types`
      : "/evaluation-types";
    return api.get<{ types: CanonicalEvaluationType[] }>(`${path}${query ? `?${query}` : ""}`);
  },
  create: (payload: Record<string, unknown>, schoolCode?: string) =>
    schoolCode
      ? api.post<CanonicalEvaluationType>(
          `/backoffice/establishments/${encodeURIComponent(schoolCode)}/evaluation-types`,
          payload,
        )
      : api.post<CanonicalEvaluationType>("/evaluation-types", payload),
  update: (typeId: string, payload: Record<string, unknown>, schoolCode?: string) =>
    schoolCode
      ? api.patch<CanonicalEvaluationType>(
          `/backoffice/establishments/${encodeURIComponent(schoolCode)}/evaluation-types/${encodeURIComponent(typeId)}`,
          payload,
        )
      : api.patch<CanonicalEvaluationType>(`/evaluation-types/${encodeURIComponent(typeId)}`, payload),
  archive: (typeId: string, schoolCode?: string) =>
    schoolCode
      ? api.post<CanonicalEvaluationType>(
          `/backoffice/establishments/${encodeURIComponent(schoolCode)}/evaluation-types/${encodeURIComponent(typeId)}/archive`,
          {},
        )
      : api.post<CanonicalEvaluationType>(`/evaluation-types/${encodeURIComponent(typeId)}/archive`, {}),
};
