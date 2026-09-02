/**
 * Session restreinte mustChangePassword : tokens mémoire uniquement.
 * Un kill/relaunch ne doit jamais restaurer Home.
 */

type RestrictedTokens = {
  accessToken: string;
  refreshToken: string | null;
};

let restricted: RestrictedTokens | null = null;

export function beginRestrictedSession(accessToken?: string | null, refreshToken?: string | null) {
  if (!accessToken) {
    restricted = null;
    return;
  }
  restricted = {
    accessToken,
    refreshToken: refreshToken ?? null,
  };
}

export function clearRestrictedSession() {
  restricted = null;
}

export function hasRestrictedSession(): boolean {
  return Boolean(restricted?.accessToken);
}

export function getRestrictedAccessToken(): string | null {
  return restricted?.accessToken ?? null;
}

export function getRestrictedRefreshToken(): string | null {
  return restricted?.refreshToken ?? null;
}

export function isRestrictedOnlyPath(path: string): boolean {
  const pathname = (path.split("?")[0] ?? path).trim();
  return pathname === "/auth/change-password";
}

export function assertUnrestrictedApiPath(path: string) {
  if (!hasRestrictedSession()) return;
  if (isRestrictedOnlyPath(path)) return;
  const error = new Error("Changement de mot de passe obligatoire.");
  (error as Error & { status?: number }).status = 403;
  throw error;
}
