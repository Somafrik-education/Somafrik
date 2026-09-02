import { api, getAccessToken, requestBlob } from "../api/client";
import { API_URL } from "./apiUrl";
import {
  readActiveCommunicationSchoolScope,
  withCommunicationSchoolPayload,
  withCommunicationSchoolScope,
} from "./communicationSchoolScope";

export type InternalNotificationAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

export type InternalNotificationRecord = {
  type: "notification";
  id: string;
  schoolCode?: string;
  eventType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  senderType: "system" | "user";
  senderUserId?: string | null;
  senderName: string;
  title: string;
  body: string;
  createdAt: string;
  publishedAt: string;
  readAt?: string;
  archivedAt?: string;
  status?: string;
  attachments?: InternalNotificationAttachment[];
  navigationTarget?: Record<string, unknown>;
  metadataSafe?: Record<string, unknown>;
};

function scoped(path: string, schoolCode?: string): string {
  return withCommunicationSchoolScope(path, schoolCode ?? readActiveCommunicationSchoolScope());
}

function scopedPayload(payload: Record<string, unknown>, schoolCode?: string) {
  return withCommunicationSchoolPayload(payload, schoolCode ?? readActiveCommunicationSchoolScope());
}

export const internalNotificationsApi = {
  list: (schoolCode?: string) =>
    api.get<{ items: InternalNotificationRecord[]; nextCursor: string | null }>(
      scoped("/backoffice/internal-notifications", schoolCode),
    ),
  get: (id: string, schoolCode?: string) =>
    api.get<InternalNotificationRecord>(
      scoped(`/backoffice/internal-notifications/${encodeURIComponent(id)}`, schoolCode),
    ),
  unreadCount: (schoolCode?: string) =>
    api.get<{ count: number }>(scoped("/backoffice/internal-notifications/unread-count", schoolCode)),
  markRead: (id: string, schoolCode?: string) =>
    api.patch<InternalNotificationRecord>(
      scoped(`/backoffice/internal-notifications/${encodeURIComponent(id)}/read`, schoolCode),
      {},
    ),
  archive: (id: string, schoolCode?: string) =>
    api.patch<{ id: string; archivedAt: string }>(
      scoped(`/backoffice/internal-notifications/${encodeURIComponent(id)}/archive`, schoolCode),
      {},
    ),
  create: (
    payload: Record<string, unknown>,
    idempotencyKey: string,
    schoolCode?: string,
  ) =>
    api.post<InternalNotificationRecord>(
      scoped("/backoffice/internal-notifications", schoolCode),
      scopedPayload(payload, schoolCode),
      { headers: { "Idempotency-Key": idempotencyKey } },
    ),
  downloadAttachment: (attachmentId: string, schoolCode?: string) =>
    requestBlob(
      scoped(`/backoffice/internal-notifications/attachments/${encodeURIComponent(attachmentId)}`, schoolCode),
    ),
  uploadAttachment: async (file: File, schoolCode?: string) => {
    const token = getAccessToken();
    const response = await fetch(
      scoped(`${API_URL.replace(/\/$/, "")}/api/backoffice/internal-notifications/attachments`, schoolCode),
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
    if (!response.ok) throw new Error(String(data.message ?? "Échec de l'upload"));
    return data as InternalNotificationAttachment;
  },
};
