/**
 * RBAC-LOGIN-01 — rôle d'établissement personnalisé (catalogue establishment_roles).
 *
 * Le serveur marque la session `webAccessProfile = "school_custom_role"` lorsqu'il a
 * validé, sur PostgreSQL, un rôle hors liste statique : rôle actif, attribué dans cet
 * établissement, catalogue actif `scope = school`, au moins une permission Web.
 *
 * Côté Web, ce rôle est traité comme un rôle interne d'établissement (navigation,
 * périmètre, domaines scolaires) ; chaque module reste filtré par les permissions
 * effectives. Ce n'est qu'un indicateur d'affichage : l'autorisation finale est
 * toujours faite par l'API (requireAuth + requirePermission).
 *
 * Registre mono-session : réinitialisé à chaque changement de session.
 */

export const CUSTOM_SCHOOL_ROLE_WEB_PROFILE = "school_custom_role";

type CustomRoleSessionUser = {
  role?: string;
  schoolCode?: string;
  webAccessProfile?: string;
} | null | undefined;

const RESERVED_ROLE_KEYS = new Set([
  "super administrateur somafrik",
  "super administrateur okafrik",
  "super_admin",
  "admin pays",
  "country_admin",
  "parent",
  "parent_student",
  "eleve / etudiant",
  "eleve",
  "etudiant",
  "student",
  "sans affectation",
]);

const registeredRoleKeys = new Set<string>();

function roleKey(role: unknown): string {
  return String(role ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function isCustomSchoolRoleSessionUser(user: CustomRoleSessionUser): boolean {
  if (!user || user.webAccessProfile !== CUSTOM_SCHOOL_ROLE_WEB_PROFILE) return false;
  const schoolCode = String(user.schoolCode ?? "").trim();
  if (!schoolCode || schoolCode === "*") return false;
  const key = roleKey(user.role);
  return Boolean(key) && !RESERVED_ROLE_KEYS.has(key);
}

/** Aligne le registre sur la session courante (connexion, restauration, déconnexion). */
export function syncCustomSchoolRoleSession(user: CustomRoleSessionUser): void {
  registeredRoleKeys.clear();
  if (isCustomSchoolRoleSessionUser(user)) registeredRoleKeys.add(roleKey(user?.role));
}

export function isRegisteredCustomSchoolRole(role?: string): boolean {
  const key = roleKey(role);
  return Boolean(key) && registeredRoleKeys.has(key);
}
