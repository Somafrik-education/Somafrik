import { isSuperAdminRole } from "./orgHierarchy";
import { isInternalSchoolRole } from "./format";
import { COUNTRY_ADMIN_ROLE } from "./orgHierarchy";

/** Vues autorisées pour le Super Admin (tableau de bord + paramétrage + conception bulletins). */
export const SUPER_ADMIN_PLATFORM_VIEWS = [
  "overview",
  "countries",
  "schools",
  "subscriptions",
  "contacts",
  "relations",
  "users",
  "permissions",
  "chartSettings",
  "notifications",
] as const;

export const SUPER_ADMIN_SCHOOL_SETTINGS_VIEWS = ["configuration"] as const;

export const SUPER_ADMIN_BULLETIN_VIEWS = ["bulletinDesign"] as const;

export const SUPER_ADMIN_ALLOWED_VIEWS = new Set<string>([
  ...SUPER_ADMIN_PLATFORM_VIEWS,
  ...SUPER_ADMIN_SCHOOL_SETTINGS_VIEWS,
  ...SUPER_ADMIN_BULLETIN_VIEWS,
]);

/** Fonctionnalités CRUD autorisées (hors modules métier opérationnels). */
export const SUPER_ADMIN_ALLOWED_FEATURES = new Set([
  "Pays",
  "Établissements",
  "Abonnements",
  "Contacts",
  "Relations",
  "Utilisateurs",
  "Notifications",
  "Paramètres Établissement",
  "Paramètres graphiques",
  "Droits par rôle",
  "Conception bulletins",
]);

export function isSuperAdminAllowedView(view: string): boolean {
  return SUPER_ADMIN_ALLOWED_VIEWS.has(view);
}

export function isSuperAdminAllowedFeature(feature: string | null | undefined): boolean {
  if (!feature) return true;
  return SUPER_ADMIN_ALLOWED_FEATURES.has(feature);
}

export function getSuperAdminHomePath(): string {
  return "/tableau-de-bord";
}

export function getDefaultAppPath(role?: string): string {
  if (isSuperAdminRole(role)) return getSuperAdminHomePath();
  if (isInternalSchoolRole(role)) return "/etablissement";
  if (role === COUNTRY_ADMIN_ROLE) return "/tableau-de-bord";
  return "/tableau-de-bord";
}
