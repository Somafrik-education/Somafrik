import {
  resolveNotificationPushData,
  type AllowedPushDestination,
  type AllowedPushNavigationParams,
  type ResolvedNotificationNavigation,
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

export type PushTapGate = {
  isReady: () => boolean;
  isAuthenticated: () => boolean;
};

type PushNavigationTarget = ResolvedNotificationNavigation;

/** Le 3ᵉ argument porte le résultat complet du résolveur (notificationId, schoolCode). */
type NavigatePush = (
  destination: AllowedPushDestination,
  params?: AllowedPushNavigationParams,
  resolved?: ResolvedNotificationNavigation,
) => void;

const consumedIds = new Set<string>();
let pendingNavigation: PushNavigationTarget | null = null;

export function resetPushTapStateForTests() {
  consumedIds.clear();
  pendingNavigation = null;
}

export function identityOfPushResponse(response: PushTapResponse): string {
  return String(
    response?.notification?.request?.identifier || response?.identifier || "",
  ).trim();
}

export function navigationFromPushResponse(response: PushTapResponse): PushNavigationTarget {
  const data = response?.notification?.request?.content?.data;
  return resolveNotificationPushData(data);
}

export function destinationFromPushResponse(response: PushTapResponse): AllowedPushDestination {
  return navigationFromPushResponse(response).destination;
}

function canNavigate(gate: PushTapGate) {
  return Boolean(gate.isAuthenticated()) && Boolean(gate.isReady());
}

export function consumePushTapResponse(
  response: PushTapResponse,
  navigate: NavigatePush,
  gate: PushTapGate,
): "navigated" | "queued" | "ignored" {
  if (!response) return "ignored";
  const identity = identityOfPushResponse(response);
  if (identity && consumedIds.has(identity)) return "ignored";
  if (identity) consumedIds.add(identity);
  const target = navigationFromPushResponse(response);
  if (canNavigate(gate)) {
    navigate(target.destination, target.params, target);
    pendingNavigation = null;
    return "navigated";
  }
  pendingNavigation = target;
  return "queued";
}

export function flushPendingPushNavigation(
  navigate: NavigatePush,
  gate: PushTapGate,
): boolean {
  if (!pendingNavigation || !canNavigate(gate)) return false;
  const target = pendingNavigation;
  pendingNavigation = null;
  navigate(target.destination, target.params, target);
  return true;
}

export function dismissPendingPushNavigation() {
  pendingNavigation = null;
}

export async function consumeInitialPushResponse(
  readLast: () => Promise<PushTapResponse> | PushTapResponse,
  navigate: NavigatePush,
  gate: PushTapGate,
) {
  const last = await readLast();
  return consumePushTapResponse(last, navigate, gate);
}
