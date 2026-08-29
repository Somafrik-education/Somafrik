import {
  resolvePushDestination,
  type AllowedPushDestination,
} from "./pushNotificationDestinations";

export type PushTapResponse = {
  identifier?: string;
  notification?: {
    request?: {
      identifier?: string;
      content?: { data?: unknown };
    };
  };
} | null | undefined;

const consumedIds = new Set<string>();
let pendingDestination: AllowedPushDestination | null = null;

export function resetPushTapStateForTests() {
  consumedIds.clear();
  pendingDestination = null;
}

export function identityOfPushResponse(response: PushTapResponse): string {
  return String(
    response?.notification?.request?.identifier || response?.identifier || "",
  ).trim();
}

export function destinationFromPushResponse(response: PushTapResponse): AllowedPushDestination {
  const data = response?.notification?.request?.content?.data;
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return resolvePushDestination(record.somafrikDestination);
}

export function consumePushTapResponse(
  response: PushTapResponse,
  navigate: (destination: AllowedPushDestination) => void,
  isReady: () => boolean,
): "navigated" | "queued" | "ignored" {
  if (!response) return "ignored";
  const identity = identityOfPushResponse(response);
  if (identity && consumedIds.has(identity)) return "ignored";
  if (identity) consumedIds.add(identity);
  const destination = destinationFromPushResponse(response);
  if (isReady()) {
    navigate(destination);
    pendingDestination = null;
    return "navigated";
  }
  pendingDestination = destination;
  return "queued";
}

export function flushPendingPushNavigation(
  navigate: (destination: AllowedPushDestination) => void,
  isReady: () => boolean,
): boolean {
  if (!pendingDestination || !isReady()) return false;
  navigate(pendingDestination);
  pendingDestination = null;
  return true;
}

export async function consumeInitialPushResponse(
  readLast: () => Promise<PushTapResponse> | PushTapResponse,
  navigate: (destination: AllowedPushDestination) => void,
  isReady: () => boolean,
) {
  const last = await readLast();
  return consumePushTapResponse(last, navigate, isReady);
}
