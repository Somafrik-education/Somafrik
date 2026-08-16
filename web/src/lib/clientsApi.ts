import { api } from "../api/client";
import { readStoredSchoolCode } from "./activeSchool";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import type { School } from "../types";

export function buildCreateUserPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const explicitSchoolCode = String(payload.schoolCode ?? "").trim();
  const activeSchoolCode = readStoredSchoolCode();
  const schoolCode = explicitSchoolCode || activeSchoolCode;

  if (!schoolCode || schoolCode === "*") {
    return { ...payload };
  }

  return { ...payload, schoolCode };
}

interface AssignableRole {
  roleKey: string;
  roleName: string;
}

function withPlatformAssignableRoles(roles: AssignableRole[]): AssignableRole[] {
  const merged = [
    ...roles,
    { roleKey: "COUNTRY_ADMIN", roleName: COUNTRY_ADMIN_ROLE },
    { roleKey: "SCHOOL_ADMIN", roleName: SCHOOL_ADMIN_ROLE },
  ];
  const seen = new Set<string>();
  return merged.filter((entry) => {
    const key = String(entry.roleName ?? "").trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function resolveUserSchools(users: Array<Record<string, unknown>>): Promise<School[]> {
  const schoolCodes = [...new Set(
    users
      .map((user) => String(user.schoolCode ?? "").trim().toUpperCase())
      .filter((code) => code && code !== "*"),
  )];

  const results = await Promise.allSettled(
    schoolCodes.map((code) => api.get<School>(`/schools/${encodeURIComponent(code)}`)),
  );

  return results.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
}

export const clientsApi = {
  listUsers: () => api.get<unknown[]>("/backoffice/users"),
  resolveUserSchools,
  createUser: (payload: Record<string, unknown>) => api.post("/backoffice/users", buildCreateUserPayload(payload)),
  updateUser: (userId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/users/${encodeURIComponent(userId)}`, payload),
  listAssignableRoles: async () => {
    const response = await api.get<{ roles: AssignableRole[] }>("/backoffice/users/assignable-roles");
    return { ...response, roles: withPlatformAssignableRoles(response.roles ?? []) };
  },
  grantUserRole: (userId: string, role: string) =>
    api.post(`/backoffice/users/${encodeURIComponent(userId)}/roles/grant`, { role }),
  revokeUserRole: (userId: string, role: string) =>
    api.post(`/backoffice/users/${encodeURIComponent(userId)}/roles/revoke`, { role }),

  listContacts: () => api.get<unknown[]>("/backoffice/contacts"),
  createContact: (payload: Record<string, unknown>) => api.post("/backoffice/contacts", payload),
  updateContact: (contactId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/contacts/${encodeURIComponent(contactId)}`, payload),
  provisionContactAccount: (contactId: string, payload: Record<string, unknown>) =>
    api.post(`/backoffice/contacts/${encodeURIComponent(contactId)}/provision-account`, payload),

  listRelations: () => api.get<unknown[]>("/backoffice/relations"),
  createRelation: (payload: Record<string, unknown>) => api.post("/backoffice/relations", payload),

  listMessages: () => api.get<unknown[]>("/backoffice/messages"),
  sendMessage: (payload: Record<string, unknown>) => api.post("/backoffice/messages", payload),
  markMessageRead: (messageId: string) =>
    api.patch(`/backoffice/messages/${encodeURIComponent(messageId)}/read`, {}),

  listAnnouncements: () => api.get<unknown[]>("/backoffice/announcements"),
  createAnnouncement: (payload: Record<string, unknown>) => api.post("/backoffice/announcements", payload),
  updateAnnouncement: (announcementId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/announcements/${encodeURIComponent(announcementId)}`, payload),
  archiveAnnouncement: (announcementId: string) =>
    api.post(`/backoffice/announcements/${encodeURIComponent(announcementId)}/archive`, {}),
};
