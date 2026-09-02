import * as FileSystem from "expo-file-system/legacy";
import { resolveApiRootUrl } from "../config/env";
import {
  resolveCommunicationSchoolScope,
  withCommunicationSchoolPayload,
  withCommunicationSchoolScope,
} from "../lib/communicationSchoolScope";
import { getRequestSchoolScope } from "../lib/requestSchoolScope";
import { ApiClientError, httpRequest } from "./httpClient";
import { getAccessToken } from "./secureStorage";

export type InternalNotificationAttachment = {
  id: string;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
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

function schoolScope(explicit?: string | null): string {
  return resolveCommunicationSchoolScope(explicit) || resolveCommunicationSchoolScope(getRequestSchoolScope());
}

function scoped(path: string, explicit?: string | null): string {
  return withCommunicationSchoolScope(path, schoolScope(explicit));
}

export async function listInternalNotifications(schoolCode?: string) {
  return httpRequest<{ items?: InternalNotificationRecord[]; nextCursor?: string | null }>(
    scoped("/backoffice/internal-notifications", schoolCode),
  ).then((data) => ({ items: Array.isArray(data?.items) ? data.items : [], nextCursor: data?.nextCursor ?? null }));
}

export function getInternalNotification(id: string, schoolCode?: string) {
  return httpRequest<InternalNotificationRecord>(
    scoped(`/backoffice/internal-notifications/${encodeURIComponent(id)}`, schoolCode),
  );
}

export async function getInternalNotificationsUnreadCount(schoolCode?: string): Promise<number> {
  const data = await httpRequest<{ count?: number }>(
    scoped("/backoffice/internal-notifications/unread-count", schoolCode),
  );
  return Math.max(0, Number(data?.count) || 0);
}

export function markInternalNotificationRead(id: string, schoolCode?: string) {
  return httpRequest<InternalNotificationRecord>(
    scoped(`/backoffice/internal-notifications/${encodeURIComponent(id)}/read`, schoolCode),
    { method: "PATCH", body: JSON.stringify({}) },
  );
}

export function archiveInternalNotification(id: string, schoolCode?: string) {
  return httpRequest<{ id: string; archivedAt: string }>(
    scoped(`/backoffice/internal-notifications/${encodeURIComponent(id)}/archive`, schoolCode),
    { method: "PATCH", body: JSON.stringify({}) },
  );
}

export function createInternalNotification(
  payload: Record<string, unknown>,
  idempotencyKey: string,
  schoolCode?: string,
) {
  const scopedSchool = schoolScope(schoolCode);
  return httpRequest<InternalNotificationRecord>(
    scoped("/backoffice/internal-notifications", scopedSchool),
    {
      method: "POST",
      body: JSON.stringify(withCommunicationSchoolPayload(payload, scopedSchool)),
      idempotencyKey,
    },
  );
}

export async function uploadInternalNotificationAttachment(
  file: { uri: string; name: string; mimeType: string },
  schoolCode?: string,
): Promise<InternalNotificationAttachment> {
  const token = await getAccessToken();
  const root = resolveApiRootUrl().replace(/\/$/, "");
  const blob = await (await fetch(file.uri)).blob();
  const response = await fetch(
    scoped(`${root}/api/backoffice/internal-notifications/attachments`, schoolCode),
    {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": file.mimeType || "application/octet-stream",
        "X-Filename": file.name,
      },
      body: blob,
    },
  );
  const data = (await response.json().catch(() => ({}))) as InternalNotificationAttachment & { message?: string };
  if (!response.ok || !data.id) {
    throw new ApiClientError(String(data.message ?? "Échec de l'upload"), response.status);
  }
  return data;
}

export async function downloadInternalNotificationAttachment(
  attachmentId: string,
  fileName: string,
  schoolCode?: string,
): Promise<string> {
  const token = await getAccessToken();
  const root = resolveApiRootUrl().replace(/\/$/, "");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "notification-file";
  const target = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ""}${safeName}`;
  const result = await FileSystem.downloadAsync(
    scoped(`${root}/api/backoffice/internal-notifications/attachments/${encodeURIComponent(attachmentId)}`, schoolCode),
    target,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (result.status !== 200) throw new ApiClientError("Téléchargement refusé", result.status);
  return result.uri;
}
