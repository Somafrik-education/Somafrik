import { api, getAccessToken } from "../api/client";
import { API_URL } from "./apiUrl";

function idempotentHeaders(idempotencyKey?: string): HeadersInit {
  return idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {};
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

export const messagesApi = {
  listConversations: (query = "") =>
    api.get<{ items: ConversationSummary[]; nextCursor: string | null }>(
      `/backoffice/conversations${query}`,
    ),
  getConversation: (conversationId: string) =>
    api.get<ConversationSummary>(`/backoffice/conversations/${encodeURIComponent(conversationId)}`),
  listMessages: (conversationId: string, query = "") =>
    api.get<{ items: ConversationMessage[]; nextCursor: string | null }>(
      `/backoffice/conversations/${encodeURIComponent(conversationId)}/messages${query}`,
    ),
  unreadCount: () => api.get<{ count: number }>("/backoffice/messages/unread-count"),
  createConversation: (payload: Record<string, unknown>, idempotencyKey: string) =>
    api.post<ConversationMessage>("/backoffice/conversations", payload, {
      headers: idempotentHeaders(idempotencyKey),
    }),
  reply: (conversationId: string, payload: Record<string, unknown>, idempotencyKey: string) =>
    api.post<ConversationMessage>(
      `/backoffice/conversations/${encodeURIComponent(conversationId)}/messages`,
      payload,
      { headers: idempotentHeaders(idempotencyKey) },
    ),
  markRead: (messageId: string) =>
    api.patch(`/backoffice/messages/${encodeURIComponent(messageId)}/read`, {}),
  uploadAttachment: async (file: File) => {
    const token = getAccessToken();
    const response = await fetch(`${API_URL.replace(/\/$/, "")}/api/backoffice/communications/attachments`, {
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
    return data as MessageAttachment;
  },
};
