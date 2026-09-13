export const SOMAFRIK_PUSH_CHANNEL_ID = "somafrik-default-v2";
export const ALLOWED_PUSH_DESTINATIONS = [
  "Home",
  "StudentPayments",
  "Messages",
  "Announcements",
  "InternalNotifications",
] as const;
export type AllowedPushDestination = (typeof ALLOWED_PUSH_DESTINATIONS)[number];
export type AllowedPushNavigationParams = {
  studentId?: string;
  conversationId?: string;
  announcementId?: string;
};

const SAFE_RESOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function readSafeResourceId(value: unknown): string {
  const id = String(value ?? "").trim();
  return SAFE_RESOURCE_ID.test(id) ? id : "";
}

export function resolvePushDestination(value: unknown): AllowedPushDestination {
  const destination = String(value ?? "").trim();
  if ((ALLOWED_PUSH_DESTINATIONS as readonly string[]).includes(destination)) {
    return destination as AllowedPushDestination;
  }
  return "Home";
}

export function resolvePushNavigationData(data: unknown): {
  destination: AllowedPushDestination;
  params?: AllowedPushNavigationParams;
} {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const destination = resolvePushDestination(record.somafrikDestination);
  if (destination === "StudentPayments") {
    const studentId = readSafeResourceId(record.somafrikStudentId);
    if (!studentId) return { destination: "Home" };
    return { destination, params: { studentId } };
  }
  if (destination === "Messages") {
    const conversationId = readSafeResourceId(record.somafrikConversationId);
    if (!conversationId) return { destination: "Home" };
    return { destination, params: { conversationId } };
  }
  if (destination === "Announcements") {
    const announcementId = readSafeResourceId(record.somafrikAnnouncementId);
    if (!announcementId) return { destination: "Home" };
    return { destination, params: { announcementId } };
  }
  if (destination === "InternalNotifications") {
    return { destination };
  }
  return { destination: "Home" };
}

export function resolveInternalNotificationNavigationTarget(target: unknown): {
  destination: AllowedPushDestination;
  params?: AllowedPushNavigationParams;
} | null {
  const record = target && typeof target === "object" ? (target as Record<string, unknown>) : {};
  const type = String(record.type ?? "").trim();
  if (type === "finance_obligation") {
    const studentId = readSafeResourceId(record.studentId);
    if (!studentId) return null;
    return { destination: "StudentPayments", params: { studentId } };
  }
  if (type === "conversation") {
    const conversationId = readSafeResourceId(record.conversationId);
    if (!conversationId) return null;
    return { destination: "Messages", params: { conversationId } };
  }
  if (type === "announcement") {
    const announcementId = readSafeResourceId(record.announcementId);
    if (!announcementId) return null;
    return { destination: "Announcements", params: { announcementId } };
  }
  return null;
}

export function isAllowlistedPushDestination(value: unknown): boolean {
  return (ALLOWED_PUSH_DESTINATIONS as readonly string[]).includes(String(value ?? "").trim());
}
