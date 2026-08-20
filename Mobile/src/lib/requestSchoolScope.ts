/**
 * Transport du tenant école : header authentifié request-scoped.
 * Jamais SCH-* (alias interne). Jamais "*" (périmètre plateforme).
 * Ce module est la source de vérité HTTP, distincte de activeSchoolCode React.
 */

export const SCHOOL_SCOPE_HEADER = "X-Somafrik-School-Code";

const PLATFORM_EXACT_PATHS = new Set([
  "/login",
  "/identify",
  "/health",
  "/auth/refresh",
  "/auth/logout",
  "/auth/change-password",
  "/auth/effective-permissions",
]);

const PLATFORM_PREFIXES = [
  "/backoffice/establishments",
  "/backoffice/countries",
  "/backoffice/subscriptions",
  "/backoffice/notifications",
  "/auth/",
];

let requestSchoolScope: string | null = null;

export function isInternalSchoolAlias(code?: string | null): boolean {
  return /^SCH-[A-Z0-9]+$/.test(String(code ?? "").trim().toUpperCase());
}

export function publicRequestSchoolScope(code?: string | null): string | null {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!normalized || normalized === "*") return null;
  if (isInternalSchoolAlias(normalized)) return null;
  return normalized;
}

export function getRequestSchoolScope(): string | null {
  return requestSchoolScope;
}

export function setRequestSchoolScope(code?: string | null): string | null {
  requestSchoolScope = publicRequestSchoolScope(code);
  return requestSchoolScope;
}

export function clearRequestSchoolScope(): void {
  requestSchoolScope = null;
}

export function pathnameOf(path: string): string {
  return (path.split("?")[0] ?? path).trim();
}

export function isSchoolScopedApiPath(path: string): boolean {
  const pathname = pathnameOf(path);
  if (!pathname) return false;
  if (PLATFORM_EXACT_PATHS.has(pathname)) return false;
  if (/^\/schools\/[^/]+$/.test(pathname)) return false;
  if (PLATFORM_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return false;
  }
  return true;
}

export function applyAuthenticatedSchoolScopeHeader(
  headers: { set: (name: string, value: string) => void },
  path: string,
  options: { skipAuth?: boolean } = {},
): boolean {
  if (options.skipAuth) return false;
  if (!isSchoolScopedApiPath(path)) return false;
  const scope = getRequestSchoolScope();
  if (!scope) return false;
  headers.set(SCHOOL_SCOPE_HEADER, scope);
  return true;
}
