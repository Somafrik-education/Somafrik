import { api } from "../api/client";

export type LinkParentPayload = {
  studentId: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  relationType?: string;
};

export type ParentIdentityLookup = {
  found: boolean;
  reuse?: boolean;
  message?: string;
  user?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
};

export const parentsApi = {
  lookupIdentity: (query: { phone?: string; email?: string }) => {
    const params = new URLSearchParams();
    if (query.phone) params.set("phone", query.phone);
    if (query.email) params.set("email", query.email);
    const suffix = params.toString();
    return api.get<ParentIdentityLookup>(`/parents/identity${suffix ? `?${suffix}` : ""}`);
  },
  linkParent: (payload: LinkParentPayload) => api.post("/parents/link", payload),
  archiveRelation: (relationId: string) =>
    api.patch(`/parents/relations/${encodeURIComponent(relationId)}`, { status: "archived" }),
};
