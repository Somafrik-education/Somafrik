import { api, getAccessToken, requestBlob } from "../api/client";
import { API_URL } from "./apiUrl";
import {
  readActiveCommunicationSchoolScope,
  withCommunicationSchoolPayload,
  withCommunicationSchoolScope,
} from "./communicationSchoolScope";

function idempotentHeaders(idempotencyKey?: string): HeadersInit {
  return idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {};
}

function scoped(path: string, schoolCode?: string): string {
  return withCommunicationSchoolScope(path, schoolCode ?? readActiveCommunicationSchoolScope());
}

function scopedPayload(payload: Record<string, unknown>, schoolCode?: string) {
  return withCommunicationSchoolPayload(payload, schoolCode ?? readActiveCommunicationSchoolScope());
}

export type AnnouncementAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

export type AnnouncementAudience = {
  scope?: string;
  classIds?: string[];
  recipientKinds?: string[];
};

export type AnnouncementRecord = {
  id: string;
  type?: string;
  schoolCode?: string;
  title: string;
  content?: string;
  message?: string;
  createdByUserId?: string;
  createdByName?: string;
  publishedByUserId?: string;
  publishedByName?: string;
  createdAt?: string;
  publishedAt?: string;
  updatedAt?: string;
  archivedAt?: string;
  status?: string;
  audience?: AnnouncementAudience | string;
  audienceLabel?: string;
  recipientCount?: number;
  readsCount?: number;
  unreadCount?: number;
  readAt?: string;
  attachments?: AnnouncementAttachment[];
  unresolved?: boolean;
};

export type AudienceClassOption = {
  id: string;
  code: string;
  name: string;
};

export type AudienceKindOption = {
  id: string;
  label: string;
};

function unwrapItems<T>(data: T[] | { items?: T[] } | null | undefined): T[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export const announcementsApi = {
  list: async (schoolCode?: string) => {
    const data = await api.get<{ items: AnnouncementRecord[]; nextCursor: string | null } | AnnouncementRecord[]>(
      scoped("/backoffice/announcements", schoolCode),
    );
    return { items: unwrapItems(data), nextCursor: !Array.isArray(data) ? data.nextCursor ?? null : null };
  },
  get: (id: string, schoolCode?: string) =>
    api.get<AnnouncementRecord>(scoped(`/backoffice/announcements/${encodeURIComponent(id)}`, schoolCode)),
  unreadCount: (schoolCode?: string) =>
    api.get<{ count: number }>(scoped("/backoffice/announcements/unread-count", schoolCode)),
  audienceOptions: (schoolCode?: string) =>
    api.get<{ classes: AudienceClassOption[]; recipientKinds: AudienceKindOption[] }>(
      scoped("/backoffice/announcements/audience-options", schoolCode),
    ),
  publish: (payload: Record<string, unknown>, idempotencyKey: string, schoolCode?: string) =>
    api.post<AnnouncementRecord>(
      scoped("/backoffice/announcements", schoolCode),
      scopedPayload(payload, schoolCode),
      { headers: idempotentHeaders(idempotencyKey) },
    ),
  markRead: (id: string, schoolCode?: string) =>
    api.patch<AnnouncementRecord>(scoped(`/backoffice/announcements/${encodeURIComponent(id)}/read`, schoolCode), {}),
  archive: (id: string, schoolCode?: string) =>
    api.post<AnnouncementRecord>(
      scoped(`/backoffice/announcements/${encodeURIComponent(id)}/archive`, schoolCode),
      scopedPayload({}, schoolCode),
    ),
  downloadAttachment: (attachmentId: string, schoolCode?: string) =>
    requestBlob(scoped(`/backoffice/communications/attachments/${encodeURIComponent(attachmentId)}`, schoolCode)),
  uploadAttachment: async (file: File, schoolCode?: string) => {
    const token = getAccessToken();
    const response = await fetch(
      scoped(`${API_URL.replace(/\/$/, "")}/api/backoffice/announcements/attachments`, schoolCode),
      {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": file.name,
        },
        body: file,
      },
    );
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new Error(String(data.message ?? "Échec de l'upload"));
    }
    return data as AnnouncementAttachment;
  },
};
