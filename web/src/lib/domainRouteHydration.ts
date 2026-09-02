import { useSyncExternalStore } from "react";

export type DomainRouteHydrationStatus = "idle" | "loading" | "ready" | "error";

const statuses = new Map<string, DomainRouteHydrationStatus>();
const listeners = new Map<string, Set<() => void>>();

export function buildDomainRouteHydrationKey(
  locationKey: string,
  pathname: string,
  schoolCode?: string,
): string {
  return [
    String(locationKey || "default"),
    String(pathname || "/"),
    String(schoolCode ?? "").trim().toUpperCase(),
  ].join("::");
}

export function setDomainRouteHydrationStatus(
  key: string,
  status: DomainRouteHydrationStatus,
): void {
  statuses.set(key, status);
  listeners.get(key)?.forEach((listener) => listener());
}

function subscribe(key: string, listener: () => void): () => void {
  const current = listeners.get(key) ?? new Set<() => void>();
  current.add(listener);
  listeners.set(key, current);

  return () => {
    const registered = listeners.get(key);
    registered?.delete(listener);
    if (!registered?.size) {
      listeners.delete(key);
      statuses.delete(key);
    }
  };
}

function getSnapshot(key: string): DomainRouteHydrationStatus {
  return statuses.get(key) ?? "idle";
}

export function useDomainRouteHydrationStatus(key: string): DomainRouteHydrationStatus {
  return useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => getSnapshot(key),
    () => "idle",
  );
}
