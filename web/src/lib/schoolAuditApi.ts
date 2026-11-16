import { api } from "../api/client";

export type SchoolAuditSummary = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string;
  createdAt: string | null;
};

export type SchoolAuditListFilters = {
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

function buildAuditQuery(filters: SchoolAuditListFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  const query = params.toString();
  return query ? `/audit?${query}` : "/audit";
}

export function listSchoolAuditSummaries(filters: SchoolAuditListFilters = {}) {
  return api.get<SchoolAuditSummary[]>(buildAuditQuery(filters));
}
