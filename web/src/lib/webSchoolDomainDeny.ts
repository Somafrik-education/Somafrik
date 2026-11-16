/**
 * P1-07 / P1-10 — Superadmin / Admin Pays / ALL_PRIVILEGES seul ne sont pas
 * des Admin School globaux côté Web.
 * Un rôle scolaire lié (Admin School, Teacher, Parent, Student, …) conserve
 * son établissement, même avec ALL_PRIVILEGES ou schoolCode "*".
 */
import { isInternalSchoolRole, isParentRole, isSchoolAdminRole, normalize } from "./format";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";

const WEB_SCHOOL_DOMAIN_FEATURES = new Set([
  "Élèves",
  "Classes",
  "Enseignants",
  "Présences",
  "Notes",
  "Paiements",
  "Impayés",
  "Frais & tarifs",
  "Messages",
  "Planning de cours",
  "Affectations",
  "Matières",
  "Examens",
  "Bulletins",
  "Documents",
  "Relations",
  "Mon abonnement",
]);

type WebScopeUser = {
  role?: string;
  permissions?: string[];
  schoolCode?: string;
} | null | undefined;

export function isWebPlatformAdminUser(user?: { role?: string } | null): boolean {
  if (!user?.role) return false;
  return isSuperAdminRole(user.role) || user.role === COUNTRY_ADMIN_ROLE;
}

function isStudentRole(role?: string): boolean {
  const key = normalize(role);
  return key === "eleve / etudiant" || key === "eleve" || key === "etudiant" || key === "student";
}

/** Rôle réellement rattaché à un établissement : le jeton ALL_PRIVILEGES ne le dénie pas. */
export function hasWebSchoolBoundRole(user?: { role?: string } | null): boolean {
  if (!user?.role || isWebPlatformAdminUser(user)) return false;
  return isInternalSchoolRole(user.role) || isSchoolAdminRole(user.role) || isParentRole(user.role) || isStudentRole(user.role);
}

export function hasWildcardSchoolCode(user?: { schoolCode?: string } | null): boolean {
  return String(user?.schoolCode ?? "").trim() === "*";
}

export function hasAllPrivilegesToken(user?: { permissions?: string[] } | null): boolean {
  return Array.isArray(user?.permissions) && user.permissions.includes("ALL_PRIVILEGES");
}

export function isWebSchoolDomainFeature(feature?: string | null): boolean {
  return typeof feature === "string" && WEB_SCHOOL_DOMAIN_FEATURES.has(feature);
}

/**
 * Deny scolaire : plateforme d'abord, puis rôle établissement (allow),
 * puis schoolCode "*" ou ALL_PRIVILEGES sans rôle scolaire.
 */
export function shouldDenyWebSchoolDomain(user?: WebScopeUser): boolean {
  if (!user) return false;
  if (isWebPlatformAdminUser(user)) return true;
  if (hasWebSchoolBoundRole(user)) return false;
  if (hasWildcardSchoolCode(user)) return true;
  if (hasAllPrivilegesToken(user)) return true;
  return false;
}

/** C4 établissement : un code actif ne suffit pas si le domaine scolaire est refusé. */
export function hasWebInternalNotificationScope(
  user?: WebScopeUser,
  activeSchoolCode?: string | null,
): boolean {
  if (shouldDenyWebSchoolDomain(user)) return false;
  const code = String(activeSchoolCode ?? "").trim();
  return Boolean(code && code !== "*");
}

export function resolveWebNotificationsHref(
  user?: WebScopeUser,
): "/notifications" | "/notifications-plateforme" {
  return shouldDenyWebSchoolDomain(user) ? "/notifications-plateforme" : "/notifications";
}
