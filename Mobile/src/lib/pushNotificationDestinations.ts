export const SOMAFRIK_PUSH_CHANNEL_ID = "somafrik-default";
export const ALLOWED_PUSH_DESTINATIONS = ["Home", "StudentPayments"] as const;
export type AllowedPushDestination = (typeof ALLOWED_PUSH_DESTINATIONS)[number];
export type AllowedPushNavigationParams = { studentId?: string };

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
  if (destination !== "StudentPayments") return { destination: "Home" };
  const studentId = String(record.somafrikStudentId ?? "").trim();
  if (!studentId) return { destination: "Home" };
  return { destination, params: { studentId } };
}

export function resolveInternalNotificationNavigationTarget(target: unknown): {
  destination: AllowedPushDestination;
  params?: AllowedPushNavigationParams;
} | null {
  const record = target && typeof target === "object" ? (target as Record<string, unknown>) : {};
  if (String(record.type ?? "").trim() !== "finance_obligation") return null;
  const studentId = String(record.studentId ?? "").trim();
  if (!studentId) return null;
  return { destination: "StudentPayments", params: { studentId } };
}

export function isAllowlistedPushDestination(value: unknown): boolean {
  return (ALLOWED_PUSH_DESTINATIONS as readonly string[]).includes(String(value ?? "").trim());
}
