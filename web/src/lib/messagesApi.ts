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

export type ConversationParticipant = {
  userId: string;
  name: string;
  roleLabel?: string;
  status?: string;
};

export type MessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

export type ConversationMessage = {
  id: string;
  type?: string;
  conversationId: string;
  body?: string;
  message?: string;
  content?: string;
  senderUserId: string;
  senderName: string;
  sentAt: string;
  createdAt?: string;
  readAt?: string;
  status?: string;
  attachments?: MessageAttachment[];
  participants?: ConversationParticipant[];
  schoolCode?: string;
  audit?: unknown[];
};

export type ConversationSummary = {
  id: string;
  subject?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  participants?: ConversationParticipant[];
  lastMessage?: {
    id: string;
    body?: string;
    sentAt?: string;
    senderUserId?: string;
    senderName?: string;
  } | null;
  unreadCount?: number;
};

export type MessageRecipient = {
  userId: string;
  displayName: string;
  roleLabel?: string;
  studentId?: string;
  studentName?: string;
  className?: string;
};

export const messagesApi = {
  listRecipients: (schoolCode?: string) =>
    api.get<{ items: MessageRecipient[] } | MessageRecipient[]>(scoped("/backoffice/messages/recipients", schoolCode)),
  listConversations: (query = "", schoolCode?: string) =>
    api.get<{ items: ConversationSummary[]; nextCursor: string | null }>(
      scoped(`/backoffice/conversations${query}`, schoolCode),
    ),
  getConversation: (conversationId: string, schoolCode?: string) =>
    api.get<ConversationSummary>(
      scoped(`/backoffice/conversations/${encodeURIComponent(conversationId)}`, schoolCode),
    ),
  listMessages: (conversationId: string, query = "", schoolCode?: string) =>
    api.get<{ items: ConversationMessage[]; nextCursor: string | null }>(
      scoped(`/backoffice/conversations/${encodeURIComponent(conversationId)}/messages${query}`, schoolCode),
    ),
  unreadCount: (schoolCode?: string) =>
    api.get<{ count: number }>(scoped("/backoffice/messages/unread-count", schoolCode)),
  createConversation: (payload: Record<string, unknown>, idempotencyKey: string, schoolCode?: string) =>
    api.post<ConversationMessage>(scoped("/backoffice/conversations", schoolCode), scopedPayload(payload, schoolCode), {
      headers: idempotentHeaders(idempotencyKey),
    }),
  reply: (conversationId: string, payload: Record<string, unknown>, idempotencyKey: string, schoolCode?: string) =>
    api.post<ConversationMessage>(
      scoped(`/backoffice/conversations/${encodeURIComponent(conversationId)}/messages`, schoolCode),
      scopedPayload(payload, schoolCode),
      { headers: idempotentHeaders(idempotencyKey) },
    ),
  markRead: (messageId: string, schoolCode?: string) =>
    api.patch(scoped(`/backoffice/messages/${encodeURIComponent(messageId)}/read`, schoolCode), {}),
  downloadAttachment: (attachmentId: string, schoolCode?: string) =>
    requestBlob(scoped(`/backoffice/communications/attachments/${encodeURIComponent(attachmentId)}`, schoolCode)),
  uploadAttachment: async (file: File, schoolCode?: string) => {
    const token = getAccessToken();
    const response = await fetch(
      scoped(`${API_URL.replace(/\/$/, "")}/api/backoffice/communications/attachments`, schoolCode),
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
    return data as MessageAttachment;
  },
};
