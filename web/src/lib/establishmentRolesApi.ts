import { api } from "../api/client";

export type EstablishmentRole = {
  id: string;
  roleCode: string;
  roleName: string;
  scope: "school" | "platform" | "country";
  displayOrder: number;
  status: "active" | "archived";
  schoolAssignable: boolean;
  permissions: string[];
  delegationPermissions: string[];
};

export const establishmentRolesApi = {
  listCatalogue: (options?: { includeArchived?: boolean; schoolAssignableOnly?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.includeArchived) params.set("includeArchived", "true");
    if (options?.schoolAssignableOnly) params.set("schoolAssignableOnly", "true");
    const query = params.toString();
    return api.get<{ roles: EstablishmentRole[] }>(
      `/backoffice/establishment-roles${query ? `?${query}` : ""}`,
    );
  },
  listAssignable: () => api.get<{ roles: EstablishmentRole[] }>("/establishment-roles/assignable"),
  createRole: (payload: Record<string, unknown>) =>
    api.post<EstablishmentRole>("/backoffice/establishment-roles", payload),
  updateRole: (roleId: string, payload: Record<string, unknown>) =>
    api.patch<EstablishmentRole>(`/backoffice/establishment-roles/${encodeURIComponent(roleId)}`, payload),
  archiveRole: (roleId: string) =>
    api.post<EstablishmentRole>(`/backoffice/establishment-roles/${encodeURIComponent(roleId)}/archive`, {}),
};
