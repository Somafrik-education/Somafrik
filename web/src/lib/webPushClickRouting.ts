/**
 * Clic Web Push : destination Somafrik allowlistée uniquement.
 * Toute URL / href / location portée par le payload est ignorée.
 */

import {
  notificationDestinationContract,
  resolveNotificationDestination,
  type NotificationNavigationTarget,
} from "./notificationNavigation";

export const WEB_PUSH_FALLBACK_PATH = "/notifications";

const ALLOWED_PATHS = new Set([
  WEB_PUSH_FALLBACK_PATH,
  ...notificationDestinationContract().map((row) => row.path),
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function webPushAllowedPaths(): string[] {
  return [...ALLOWED_PATHS].sort();
}

export function isAllowlistedAppPath(path: string): boolean {
  const raw = String(path ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || /[a-z]+:/i.test(raw)) return false;
  const pathname = raw.split("?")[0];
  return ALLOWED_PATHS.has(pathname);
}

export function resolveWebPushClickPath(data: unknown): string {
  const payload = asRecord(data);
  const destination = resolveNotificationDestination(
    asRecord(payload.navigationTarget) as NotificationNavigationTarget,
  );
  if (destination && isAllowlistedAppPath(destination)) return destination;
  return WEB_PUSH_FALLBACK_PATH;
}

export function resolveWebPushClickHref(
  data: unknown,
  options: { origin: string; basePath?: string },
): string {
  const path = resolveWebPushClickPath(data);
  let originUrl: URL;
  try {
    originUrl = new URL(options.origin);
  } catch {
    return WEB_PUSH_FALLBACK_PATH;
  }
  const prefix =
    !options.basePath || options.basePath === "/" ? "" : options.basePath.replace(/\/$/, "");
  const href = `${originUrl.origin}${prefix}${path}`;
  try {
    const result = new URL(href);
    if (result.origin !== originUrl.origin) {
      return `${originUrl.origin}${prefix}${WEB_PUSH_FALLBACK_PATH}`;
    }
    return result.href;
  } catch {
    return `${originUrl.origin}${prefix}${WEB_PUSH_FALLBACK_PATH}`;
  }
}
