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

export type RbacGrantSource = "school" | "country" | "global" | "none";

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
  source?: RbacGrantSource;
  inherited?: boolean;
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

export type RbacResetOverridePayload = {
  roleKey: string;
  countryCode?: string;
  schoolCode?: string;
  moduleKey: string;
  expectedUpdatedAt?: string | null;
};

export type RbacConfiguredQuery = {
  roleKey: string;
  countryCode?: string;
  schoolCode?: string;
};

export type RbacHistoryQuery = {
  limit?: number;
  offset?: number;
};

export type RbacHistoryItem = {
  id: string;
  createdAt: string | null;
  actor: string;
  action: string;
  role: string;
  roleKey?: string | null;
  moduleKey?: string | null;
  scope: string;
  before: string;
  after: string;
  summary: string;
};

export type RbacHistoryPage = {
  items: RbacHistoryItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
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
  resetOverride: (payload: RbacResetOverridePayload) =>
    api.post<RbacConfiguredMatrix>("/backoffice/rbac/permissions/reset", payload),
  createRole: (payload: Record<string, unknown>) => api.post<RbacRole>("/backoffice/rbac/roles", payload),
  updateRole: (roleId: string, payload: Record<string, unknown>) =>
    api.patch<RbacRole>(`/backoffice/rbac/roles/${encodeURIComponent(roleId)}`, payload),
  archiveRole: (roleId: string) =>
    api.post<RbacRole>(`/backoffice/rbac/roles/${encodeURIComponent(roleId)}/archive`, {}),
  getHistory: (query: RbacHistoryQuery = {}) => {
    const params = new URLSearchParams();
    if (query.limit != null) params.set("limit", String(query.limit));
    if (query.offset != null) params.set("offset", String(query.offset));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return api.get<RbacHistoryPage>(`/backoffice/rbac/history${suffix}`);
  },
};
