import { api } from "../api/client";

export const clientsApi = {
  listUsers: () => api.get<unknown[]>("/backoffice/users"),
  createUser: (payload: Record<string, unknown>) => api.post("/backoffice/users", payload),
  updateUser: (userId: string, payload: Record<string, unknown>) =>
    api.patch(`/backoffice/users/${encodeURIComponent(userId)}`, payload),
  listAssignableRoles: () => api.get<{ roles: Array<{ roleKey: string; roleName: string }> }>("/backoffice/users/assignable-roles"),
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
