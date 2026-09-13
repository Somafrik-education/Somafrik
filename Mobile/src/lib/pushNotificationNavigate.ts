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
