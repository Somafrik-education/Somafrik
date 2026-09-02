import { isSchoolAdminRole } from "./format";
import { resolveCanonicalRoleIdentity } from "./canonicalRoleIdentity";
import { isSuperAdminRole } from "./orgHierarchy";

/** Routes / vues du lot Paramètres établissement Mobile — pas le catalogue pays. */
export const SCHOOL_SETTINGS_VIEWS = [
  "Configuration",
  "EstablishmentProfile",
  "SchoolYearSettings",
  "SchoolPedagogicalStructure",
  "SchoolAssignableRoles",
] as const;

export type SchoolSettingsView = (typeof SCHOOL_SETTINGS_VIEWS)[number];

export function isSchoolSettingsView(viewName?: string): viewName is SchoolSettingsView {
  return Boolean(viewName && (SCHOOL_SETTINGS_VIEWS as readonly string[]).includes(viewName));
}

/**
 * Parité Web `canReadView("configuration")` : Super Admin (allowlist séparée)
 * ou Admin School. Un Préfet / Directeur avec `Paramètres Établissement:READ`
 * ne devient pas opérateur des écrans Paramètres.
 */
export function isSchoolSettingsOperator(session: any): boolean {
  if (!session) return false;
  if (session.role === "super_admin" || isSuperAdminRole(session.role)) return true;
  if (session.role === "country_admin") return false;
  const identity = resolveCanonicalRoleIdentity(session);
  return isSchoolAdminRole(identity.sessionRole) || isSchoolAdminRole(identity.roleLabel);
}
