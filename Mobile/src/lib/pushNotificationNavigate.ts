import { safeLogger } from "../services/safeLogger";
import type { AllowedPushDestination, AllowedPushNavigationParams } from "./pushNotificationDestinations";

type NavigationStateLike = {
  routeNames?: string[];
  routes?: Array<{ name?: string; state?: unknown }>;
};

export function collectRegisteredRouteNames(
  state: NavigationStateLike | undefined,
  acc = new Set<string>(),
): Set<string> {
  if (!state) return acc;
  for (const name of state.routeNames ?? []) acc.add(name);
  for (const route of state.routes ?? []) {
    if (route.name) acc.add(route.name);
    if (route.state && typeof route.state === "object") {
      collectRegisteredRouteNames(route.state as NavigationStateLike, acc);
    }
  }
  return acc;
}

export function resolveRegisteredPushDestination(
  destination: AllowedPushDestination,
  registeredRouteNames: Iterable<string>,
): AllowedPushDestination {
  if (destination === "Home") return "Home";
  const names = registeredRouteNames instanceof Set ? registeredRouteNames : new Set(registeredRouteNames);
  return names.has(destination) ? destination : "Home";
}

export function navigateRegisteredPushDestination(
  navigate: (destination: AllowedPushDestination, params?: AllowedPushNavigationParams) => void,
  destination: AllowedPushDestination,
  params: AllowedPushNavigationParams | undefined,
  registeredRouteNames: Iterable<string>,
) {
  const resolved = resolveRegisteredPushDestination(destination, registeredRouteNames);
  navigate(resolved, resolved === destination ? params : undefined);
}

let expectedPushRoute: AllowedPushDestination | null = null;

export function observePushNavigationState(state: NavigationStateLike | undefined): void {
  if (!expectedPushRoute || !state) return;
  const index = typeof (state as { index?: unknown }).index === "number"
    ? (state as { index: number }).index
    : (state.routes?.length ?? 1) - 1;
  const active = state.routes?.[index]?.name || "unknown";
  // Only route names, never school IDs, notification IDs or message contents.
  safeLogger.warn("NOTIF_NAV_STATE", { expected: expectedPushRoute, active, matched: active === expectedPushRoute });
  expectedPushRoute = null;
}

type PushNavigationRef = {
  isReady?: () => boolean;
  navigate: (...args: never[]) => unknown;
  getRootState?: () => unknown;
};

/** Real tap adapter used by PushNotificationsRuntime and AppNavigator.onReady. */
export function callPushNavigationRef(
  navigate: (...args: never[]) => unknown,
  name: string,
  params?: AllowedPushNavigationParams,
) {
  (navigate as (screen: string, nextParams?: AllowedPushNavigationParams) => unknown)(name, params);
}

export function dispatchRegisteredPushNavigation(
  navigation: PushNavigationRef,
  destination: AllowedPushDestination,
  params?: AllowedPushNavigationParams,
) {
  if (typeof navigation.isReady === "function" && !navigation.isReady()) return;
  expectedPushRoute = destination;
  safeLogger.warn("NOTIF_NAV_DISPATCH", { destination });
  navigateRegisteredPushDestination(
    // Conserver le receveur du ref React Navigation pour les méthodes sensibles au contexte.
    (name, nextParams) => callPushNavigationRef(
      ((...args: never[]) => navigation.navigate(...args)) as (...args: never[]) => unknown,
      name,
      nextParams,
    ),
    destination,
    params,
    collectRegisteredRouteNames(navigation.getRootState?.() as NavigationStateLike | undefined),
  );
}
