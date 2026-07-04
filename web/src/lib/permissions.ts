import type { SessionUser } from "../types";
import { VIEW_PERMISSION_FEATURES } from "./constants";
import { getInternalRoleDefaults } from "./internalRoleDefaults";
import { isInternalSchoolRole, normalize, isSchoolAdminRole } from "./format";
import { canSchoolAdminMutateTeachers } from "./pedagogyGovernance";
import {
  isSuperAdminRole,
  COUNTRY_ADMIN_ROLE,
  SUPERADMIN_MANAGED_ROLES,
} from "./orgHierarchy";
import {
  isEstablishmentOperationalRole,
  COUNTRY_SCOPE_MODULES,
  normalizeManagedRolePermissions,
} from "./roleGovernance";
import { SCHOOL_ENTITY_SIDEBAR_VIEWS } from "./entityModules";
import {
  isSuperAdminAllowedFeature,
  isSuperAdminAllowedView,
} from "./superAdminAccess";

const SCHOOL_ADMIN_FORBIDDEN_FEATURES = new Set(["Établissements", "Abonnements"]);

export function canAccessSchoolBackOffice(role?: string): boolean {
  if (isSuperAdminRole(role)) return false;
  return isInternalSchoolRole(role);
}

export interface PermissionContext {
  user: SessionUser | null;
  rolePermissions: Record<string, string[]>;
}

export interface FeaturePermissions {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canSuspend: boolean;
}

/** Union des droits du compte et de la matrice Super Admin pour le rôle courant. */
export function resolveEffectivePermissions(
  role: string | undefined,
  userPermissions: string[] | undefined,
  rolePermissions: Record<string, string[]>,
): string[] {
  const fromUser = userPermissions ?? [];
  const fromRole = role && Array.isArray(rolePermissions[role]) ? rolePermissions[role] : [];
  const fromDefaults = getInternalRoleDefaults(role);
  const merged = [...new Set([...fromUser, ...fromRole, ...fromDefaults])];
  if (isSuperAdminRole(role) && !merged.includes("ALL_PRIVILEGES")) {
    merged.push("ALL_PRIVILEGES");
  }
  return merged;
}

export function getCurrentRolePermissions(ctx: PermissionContext): string[] {
  return resolveEffectivePermissions(ctx.user?.role, ctx.user?.permissions, ctx.rolePermissions);
}

const COUNTRY_PRIVILEGE_FEATURES = new Set(["pays", "etablissements", "abonnements", "utilisateurs", "rapports"]);

function countryPrivilegeAllowsRead(normalizedFeature: string): boolean {
  return COUNTRY_PRIVILEGE_FEATURES.has(normalizedFeature);
}

function permissionMatchesFeature(
  normalizedPermission: string,
  normalizedFeature: string,
  action: string,
): boolean {
  if (normalizedPermission === "country-privileges") {
    return action === "READ" && countryPrivilegeAllowsRead(normalizedFeature);
  }
  if (normalizedPermission === "all-privileges") {
    return true;
  }
  if (!normalizedPermission.includes(normalizedFeature)) {
    return false;
  }
  if (action === "READ") {
    return (
      normalizedPermission.includes("voir") ||
      normalizedPermission.includes("lire") ||
      normalizedPermission.includes("gerer") ||
      normalizedPermission.includes("auditer") ||
      normalizedPermission.includes("suivre") ||
      normalizedPermission.includes("controler") ||
      normalizedPermission.includes("controle") ||
      normalizedPermission.includes("valider") ||
      normalizedPermission.includes("publier") ||
      normalizedPermission.includes("faire") ||
      normalizedPermission.includes("organiser") ||
      normalizedPermission.includes("creer") ||
      normalizedPermission.includes("ajouter") ||
      normalizedPermission.includes("modifier") ||
      normalizedPermission.includes("messages") ||
      normalizedPermission.includes("annonces") ||
      normalizedPermission.includes("communications")
    );
  }
  return (
    normalizedPermission.includes(normalize(action)) ||
    normalizedPermission.includes("gerer") ||
    normalizedPermission.includes("crud") ||
    (action === "CREATE" && normalizedPermission.includes("ajouter"))
  );
}

function hasGranularPermission(permissions: Set<string>, feature: string, action: string): boolean {
  if (permissions.has(`${feature}:${action}`)) return true;
  if (permissions.has(`${feature}:CRUD`)) return true;
  if (action === "READ" && (permissions.has(`${feature}:READ`) || permissions.has(`${feature}:R`))) {
    return true;
  }
  return false;
}

function hasLegacyPermission(permissions: Set<string>, feature: string, action: string): boolean {
  const normalizedFeature = normalize(feature);
  return [...permissions].some((permission) =>
    permissionMatchesFeature(normalize(permission), normalizedFeature, action),
  );
}

function hasPrivilegeBundlePermission(
  permissions: Set<string>,
  feature: string,
  action: string,
): boolean {
  if (permissions.has("ALL_PRIVILEGES")) return true;
  if (permissions.has("COUNTRY_PRIVILEGES") && action === "READ") {
    return countryPrivilegeAllowsRead(normalize(feature));
  }
  return false;
}

function hasPermissionForFeature(
  ctx: PermissionContext,
  feature: string,
  action: string,
): boolean {
  const permissions = new Set(getCurrentRolePermissions(ctx));

  if (hasGranularPermission(permissions, feature, action)) return true;
  if (hasLegacyPermission(permissions, feature, action)) return true;
  if (hasPrivilegeBundlePermission(permissions, feature, action)) return true;
  return false;
}

export function canDesignBulletins(ctx: PermissionContext): boolean {
  return isSuperAdminRole(ctx.user?.role);
}

export function canManageRolePermissions(ctx: PermissionContext): boolean {
  if (isSuperAdminRole(ctx.user?.role)) return true;
  return getCurrentRolePermissions(ctx).includes("ALL_PRIVILEGES");
}

function superAdminAllowsFeature(features: string | (string | null)[] | null, action: string): boolean {
  const featureList = Array.isArray(features) ? features : [features];
  if (featureList.includes("Droits par rôle")) return action === "READ" || action === "UPDATE";
  if (featureList.includes("Paramètres graphiques")) return true;
  return featureList.every((feature) => isSuperAdminAllowedFeature(feature));
}

/** Configuration académique établissement (niveaux, classes, matières…). */
export function canManageEstablishmentSettings(ctx: PermissionContext): boolean {
  if (!ctx.user) return false;
  if (isSuperAdminRole(ctx.user.role)) return true;
  // Parmi les rôles de l'établissement, seul l'Admin School peut paramétrer.
  return isSchoolAdminRole(ctx.user.role) && hasBackOfficePermission(ctx, "Paramètres Établissement", "UPDATE");
}

export function getFeaturePermissions(ctx: PermissionContext, feature: string): FeaturePermissions {
  return {
    canRead: hasBackOfficePermission(ctx, feature, "READ"),
    canCreate: hasBackOfficePermission(ctx, feature, "CREATE"),
    canUpdate: hasBackOfficePermission(ctx, feature, "UPDATE"),
    canDelete: hasBackOfficePermission(ctx, feature, "DELETE"),
    canSuspend: hasBackOfficePermission(ctx, feature, "SUSPEND"),
  };
}

export function hasBackOfficePermission(
  ctx: PermissionContext,
  features: string | (string | null)[] | null,
  action: string = "READ",
): boolean {
  if (!ctx.user) return false;
  if (isSuperAdminRole(ctx.user.role)) {
    return superAdminAllowsFeature(features, action);
  }

  const normalizedAction = action === "R" ? "READ" : action;
  const featureList = Array.isArray(features) ? features : [features];

  if (
    isSchoolAdminRole(ctx.user.role) &&
    featureList.some((feature) => feature === "Enseignants") &&
    !canSchoolAdminMutateTeachers(normalizedAction)
  ) {
    return false;
  }

  if (
    isInternalSchoolRole(ctx.user.role) &&
    featureList.some((feature) => feature && SCHOOL_ADMIN_FORBIDDEN_FEATURES.has(feature))
  ) {
    return false;
  }

  if (featureList.includes("Droits par rôle")) return canManageRolePermissions(ctx);
  if (featureList.includes("Paramètres graphiques")) return canManageRolePermissions(ctx);
  if (featureList.some((feature) => feature === "Conception bulletins")) {
    return false;
  }

  return featureList.some((feature) => {
    if (!feature) return true;
    return hasPermissionForFeature(ctx, feature, normalizedAction);
  });
}

export function canReadView(ctx: PermissionContext, viewName: string): boolean {
  if (isSuperAdminRole(ctx.user?.role)) {
    return isSuperAdminAllowedView(viewName);
  }
  if (viewName === "overview") return true;
  if (viewName === "permissions") {
    return canManageRolePermissions(ctx);
  }
  if (viewName === "chartSettings") {
    return canManageRolePermissions(ctx);
  }
  if (viewName === "bulletinDesign") {
    return canDesignBulletins(ctx);
  }
  if (ctx.user?.role === COUNTRY_ADMIN_ROLE) {
    if (SCHOOL_ENTITY_SIDEBAR_VIEWS.has(viewName) || viewName === "establishment" || viewName === "configuration") {
      return false;
    }
    const feature = VIEW_PERMISSION_FEATURES[viewName];
    if (feature && !COUNTRY_SCOPE_MODULES.has(feature) && feature !== "Rapports") {
      return false;
    }
  }
  if (viewName === "establishment") {
    return isInternalSchoolRole(ctx.user?.role);
  }
  if (viewName === "configuration") {
    // Le paramétrage d'un établissement est réservé au Super Admin (plateforme)
    // et, parmi les rôles internes, au seul Admin School.
    if (isSuperAdminRole(ctx.user?.role)) return true;
    return isSchoolAdminRole(ctx.user?.role);
  }
  return hasBackOfficePermission(ctx, VIEW_PERMISSION_FEATURES[viewName] ?? null, "READ");
}

export function hasSchoolPilotageAccess(ctx: PermissionContext): boolean {
  if (isSuperAdminRole(ctx.user?.role)) return false;
  const schoolFeatures = [
    "Utilisateurs",
    "Classes",
    "Élèves",
    "Enseignants",
    "Affectations",
    "Présences",
    "Notes",
    "Bulletins",
    "Paiements",
    "Messages",
    "Documents",
    "Rapports",
  ];
  return (
    isInternalSchoolRole(ctx.user?.role) &&
    schoolFeatures.some((feature) => hasBackOfficePermission(ctx, feature, "READ"))
  );
}

export function getSuperadminManagedRoles(): string[] {
  return [...SUPERADMIN_MANAGED_ROLES];
}

export function getPermissionRoles(_ctx?: PermissionContext): string[] {
  return getSuperadminManagedRoles();
}

export function mergeSuperadminRolePermissions(
  current: Record<string, string[]>,
  requested: Record<string, string[]>,
): Record<string, string[]> {
  const next = { ...current };
  for (const role of SUPERADMIN_MANAGED_ROLES) {
    if (Array.isArray(requested[role])) {
      next[role] = normalizeManagedRolePermissions(role, requested[role]);
    }
  }
  return next;
}

export function isLocalManagedRole(role?: string): boolean {
  return isEstablishmentOperationalRole(role);
}
