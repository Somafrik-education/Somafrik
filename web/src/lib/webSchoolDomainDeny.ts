/**
 * P1-07 — Superadmin / Admin Pays ne sont pas des Admin School globaux côté Web.
 * Miroir Web du contrat Backend P1-02 + P0-2 / P1-03 / P1-06 et Mobile P1-04.
 * Ne pas ouvrir de domaine scolaire via ALL_PRIVILEGES ou schoolCode "*".
 */
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";

export function isWebPlatformAdminUser(user?: { role?: string } | null): boolean {
  if (!user?.role) return false;
  return isSuperAdminRole(user.role) || user.role === COUNTRY_ADMIN_ROLE;
}

/** Superadmin ou Admin Pays : jamais inbox C4, annonces scolaires, export, projection élèves. */
export function shouldDenyWebSchoolDomain(user?: { role?: string } | null): boolean {
  return isWebPlatformAdminUser(user);
}

/** C4 établissement : un code actif ne suffit pas si le principal est plateforme. */
export function hasWebInternalNotificationScope(
  user?: { role?: string } | null,
  activeSchoolCode?: string | null,
): boolean {
  if (shouldDenyWebSchoolDomain(user)) return false;
  const code = String(activeSchoolCode ?? "").trim();
  return Boolean(code && code !== "*");
}

export function resolveWebNotificationsHref(
  user?: { role?: string } | null,
): "/notifications" | "/notifications-plateforme" {
  return shouldDenyWebSchoolDomain(user) ? "/notifications-plateforme" : "/notifications";
}
