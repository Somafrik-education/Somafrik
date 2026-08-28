export const MESSAGE_ATTACHMENT_MIME = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MESSAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type MessageAttachmentRef = {
  id: string;
  fileName: string;
  mimeType?: string;
};

export type MessagePayloadInput = {
  message: string;
  recipientUserId?: string;
  conversationId?: string;
  studentId?: string;
  attachmentIds?: string[];
  attachmentUrl?: string;
  theme?: string;
  priority?: string;
  direction?: string;
};

export type MessagePayloadResult =
  | { ok: true; payload: Record<string, unknown> }
  | {
      ok: false;
      code: "empty_message" | "missing_recipient" | "client_attachment_url_forbidden" | "upload_failed";
    };

export function isAllowedMessageAttachmentMime(mimeType: string): boolean {
  return (MESSAGE_ATTACHMENT_MIME as readonly string[]).includes(String(mimeType ?? "").toLowerCase());
}

export function collectSuccessfulAttachmentIds(
  results: Array<{ ok: boolean; id?: string }>,
): { ok: true; attachmentIds: string[] } | { ok: false; code: "upload_failed" } {
  if (results.some((row) => !row.ok || !String(row.id ?? "").trim())) {
    return { ok: false, code: "upload_failed" };
  }
  return { ok: true, attachmentIds: results.map((row) => String(row.id)) };
}

export function buildMessagePayload(input: MessagePayloadInput): MessagePayloadResult {
  const body = String(input.message ?? "").trim();
  if (!body) return { ok: false, code: "empty_message" };
  if (String(input.attachmentUrl ?? "").trim()) {
    return { ok: false, code: "client_attachment_url_forbidden" };
  }
  if (!String(input.conversationId ?? "").trim() && !String(input.recipientUserId ?? "").trim()) {
    return { ok: false, code: "missing_recipient" };
  }
  const attachmentIds = (input.attachmentIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean);
  return {
    ok: true,
    payload: {
      message: body,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(!input.conversationId && input.recipientUserId
        ? { participantUserIds: [input.recipientUserId] }
        : {}),
      ...(input.studentId ? { studentId: input.studentId } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(input.theme ? { theme: input.theme } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.direction ? { direction: input.direction } : {}),
    },
  };
}
