import { api, getAccessToken, requestBlob } from "../api/client";
import { API_URL } from "./apiUrl";
import type { AnnouncementAttachment, AnnouncementRecord } from "./announcementsApi";

function idempotentHeaders(idempotencyKey?: string): HeadersInit {
  return idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {};
}

function unwrapItems<T>(data: T[] | { items?: T[] } | null | undefined): T[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

export type PlatformAnnouncementType = "administrative" | "system";
export type PlatformAudienceKey = "country_admins" | "school_admins" | "all_admins" | "all_active_users";

export type PlatformAnnouncementRecord = AnnouncementRecord & {
  source?: "platform";
  domain?: "platform";
  announcementType?: PlatformAnnouncementType;
  audienceKey?: PlatformAudienceKey;
  senderDisplayName?: string;
  originLabel?: string;
  badge?: string;
  systemBroadcast?: boolean;
};

export const platformAnnouncementsApi = {
  list: async () => {
    const data = await api.get<{ items: PlatformAnnouncementRecord[]; nextCursor: string | null } | PlatformAnnouncementRecord[]>(
      "/backoffice/platform-announcements",
    );
    return { items: unwrapItems(data), nextCursor: !Array.isArray(data) ? data.nextCursor ?? null : null };
  },
  get: (id: string) =>
    api.get<PlatformAnnouncementRecord>(`/backoffice/platform-announcements/${encodeURIComponent(id)}`),
  unreadCount: () => api.get<{ count: number }>("/backoffice/platform-announcements/unread-count"),
  publish: (
    payload: {
      announcementType: PlatformAnnouncementType;
      audienceKey: PlatformAudienceKey;
      title: string;
      message: string;
      attachmentIds?: string[];
    },
    idempotencyKey: string,
  ) =>
    api.post<PlatformAnnouncementRecord>("/backoffice/platform-announcements", payload, {
      headers: idempotentHeaders(idempotencyKey),
    }),
  markRead: (id: string) =>
    api.patch<PlatformAnnouncementRecord>(`/backoffice/platform-announcements/${encodeURIComponent(id)}/read`, {}),
  archive: (id: string) =>
    api.post<PlatformAnnouncementRecord>(
      `/backoffice/platform-announcements/${encodeURIComponent(id)}/archive`,
      {},
    ),
  downloadAttachment: (attachmentId: string) =>
    requestBlob(`/backoffice/platform-announcements/attachments/${encodeURIComponent(attachmentId)}`),
  uploadAttachment: async (file: File) => {
    const token = getAccessToken();
    const response = await fetch(`${API_URL.replace(/\/$/, "")}/api/backoffice/platform-announcements/attachments`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": file.name,
      },
      body: file,
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new Error(String(data.message ?? "Échec de l'upload"));
    }
    return data as AnnouncementAttachment;
  },
};
