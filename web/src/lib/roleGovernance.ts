import { CRUD_PERMISSION_MODULES } from "./constants";
import {
  COUNTRY_ADMIN_ROLE,
  isPlatformBackOfficeRole,
  isSuperadminManagedRole,
  SCHOOL_ADMIN_ROLE,
  SUPERADMIN_MANAGED_ROLES,
  SUPER_ADMIN_ROLE,
} from "./orgHierarchy";

export { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE } from "./orgHierarchy";

/**
 * Règles métier Somafrik — gouvernance des rôles vs niveaux hiérarchiques.
 *
 * Niveaux : Pays → Local (établissement).
 * Rôles plateforme : Admin Pays, Admin School (matrice Superadmin).
 */
export const ROLE_GOVERNANCE_NOTES = {
  superadminMatrix: `Parcours obligatoire : pays (code + nom) → établissement (code + nom) → rôle cible (catalogue PostgreSQL) → module fonctionnel → droits CRUD.`,
  localOperational: "Les rôles métier d'établissement se gèrent dans Administration → Rôles & permissions (plus dans Configuration).",
} as const;

/** Modules pilotés au niveau pays (droits Admin Pays). */
export const COUNTRY_SCOPE_MODULES = new Set(["Pays", "Établissements", "Abonnements", "Utilisateurs", "Référentiels pédagogiques"]);

export function resolveSuperadminPermissionRole(module: string): typeof COUNTRY_ADMIN_ROLE | typeof SCHOOL_ADMIN_ROLE {
  return COUNTRY_SCOPE_MODULES.has(module) ? COUNTRY_ADMIN_ROLE : SCHOOL_ADMIN_ROLE;
}

/** Modules CRUD affichés dans la matrice Superadmin selon le rôle cible. */
export function getSuperadminMatrixModules(role: string): string[] {
  return CRUD_PERMISSION_MODULES.filter((module) => {
    if (role === COUNTRY_ADMIN_ROLE) {
      return COUNTRY_SCOPE_MODULES.has(module);
    }
    if (role === SCHOOL_ADMIN_ROLE) {
      return !COUNTRY_SCOPE_MODULES.has(module);
    }
    return true;
  });
}

/** Modules disponibles pour un rôle cible dans le parcours Superadmin. */
export function getSuperadminPathModulesForRole(role: string): string[] {
  return getSuperadminMatrixModules(role);
}

/** Liste des modules fonctionnels accessibles après sélection pays + établissement. */
export function getSuperadminPathModules(): string[] {
  const modules = new Set([
    ...getSuperadminMatrixModules(COUNTRY_ADMIN_ROLE),
    ...getSuperadminMatrixModules(SCHOOL_ADMIN_ROLE),
  ]);
  return CRUD_PERMISSION_MODULES.filter((module) => modules.has(module));
}

/** Normalise les droits éditables par le Superadmin (format Module:ACTION). */
export function normalizeManagedRolePermissions(role: string, permissions: Iterable<string>): string[] {
  if (!SUPERADMIN_MANAGED_ROLES.includes(role as (typeof SUPERADMIN_MANAGED_ROLES)[number])) {
    return [...new Set(permissions)].sort();
  }

  const normalized = new Set<string>();
  for (const permission of permissions) {
    if (!permission || permission === "ALL_PRIVILEGES") continue;
    if (permission === "COUNTRY_PRIVILEGES" && role === COUNTRY_ADMIN_ROLE) {
      normalized.add(permission);
      continue;
    }
    if (/^[^:]+:[A-Z]+$/.test(permission)) {
      if (role === COUNTRY_ADMIN_ROLE && (permission === "Pays:CREATE" || permission === "Pays:DELETE")) {
        continue;
      }
      normalized.add(permission);
    }
  }
  return [...normalized].sort();
}

/** Rôle métier local établissement (pilotage Configuration), hors comptes plateforme. */
export function isEstablishmentOperationalRole(role?: string): boolean {
  if (!role || role === SUPER_ADMIN_ROLE) return false;
  if (isSuperadminManagedRole(role)) return false;
  return !isPlatformBackOfficeRole(role);
}
