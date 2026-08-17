import { api } from "../api/client";

export type RbacRole = {
  id: string;
  roleCode: string;
  roleName: string;
  scope: string;
  displayOrder: number;
  status: "active" | "archived";
  schoolAssignable: boolean;
  systemProtected?: boolean;
  activeUserCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type RbacCrudFlags = {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

export type RbacCrudGrant = RbacCrudFlags & {
  moduleKey: string;
};

export type RbacAction = "create" | "read" | "update" | "delete";

export type RbacActionFlags = {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
};

export type RbacActionLock = {
  locked: boolean;
  reason: "role_invariant" | "dependency" | null;
};

export type RbacModule = {
  moduleKey: string;
  moduleName: string;
  appliesWeb: boolean;
  appliesMobile: boolean;
  displayOrder?: number;
  canCreate?: boolean;
  canRead?: boolean;
  canUpdate?: boolean;
  canDelete?: boolean;
  configured?: boolean;
  actions?: RbacAction[];
  dependencies?: Record<string, RbacAction[]>;
  mandatory?: Partial<RbacActionFlags>;
  locks?: Record<RbacAction, RbacActionLock>;
};

export type RbacCatalog = {
  modules: RbacModule[];
  roles: RbacRole[];
  protectedRoleKeys: string[];
  mandatoryByRole?: Record<string, Record<string, Partial<RbacActionFlags>>>;
  invariants?: Record<string, string[]>;
};

export type RbacConfiguredMatrix = {
  roleKey: string;
  roleName: string;
  scopeType: "global" | "country" | "school";
  countryCode?: string | null;
  schoolCode?: string | null;
  updatedAt?: string | null;
  modules: RbacModule[];
};

export type RbacPatchPermissionsPayload = {
  roleKey: string;
  countryCode?: string;
  schoolCode?: string;
  expectedUpdatedAt?: string | null;
  grants: RbacCrudGrant[];
};

export type RbacConfiguredQuery = {
  roleKey: string;
  countryCode?: string;
  schoolCode?: string;
};

export const rbacApi = {
  getCatalog: () => api.get<RbacCatalog>("/backoffice/rbac/catalog"),
  getConfigured: (query: RbacConfiguredQuery) => {
    const params = new URLSearchParams();
    params.set("roleKey", query.roleKey);
    if (query.countryCode) params.set("countryCode", query.countryCode);
    if (query.schoolCode) params.set("schoolCode", query.schoolCode);
    return api.get<RbacConfiguredMatrix>(`/backoffice/rbac/permissions?${params.toString()}`);
  },
  patchPermissions: (payload: RbacPatchPermissionsPayload) =>
    api.patch<RbacConfiguredMatrix>("/backoffice/rbac/permissions", payload),
  createRole: (payload: Record<string, unknown>) => api.post<RbacRole>("/backoffice/rbac/roles", payload),
  updateRole: (roleId: string, payload: Record<string, unknown>) =>
    api.patch<RbacRole>(`/backoffice/rbac/roles/${encodeURIComponent(roleId)}`, payload),
  archiveRole: (roleId: string) =>
    api.post<RbacRole>(`/backoffice/rbac/roles/${encodeURIComponent(roleId)}/archive`, {}),
};
