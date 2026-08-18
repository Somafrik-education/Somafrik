import type { SessionUser, UserAccount } from "../types";
import { canManageUserAccount } from "./userAccounts";
import { isPendingValidationStatus } from "./orgHierarchy";
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
import { canManageFeeGrids, canViewFeeGrids, canViewStudentFees } from "./fees";
import {
  isEstablishmentCommunicationUser,
  isPlatformCommunicationFeature,
  isPlatformCommunicationUser,
} from "./establishmentCommunication";

const SCHOOL_ADMIN_FORBIDDEN_FEATURES = new Set(["Établissements", "Abonnements"]);

/** Rôles habilités à gérer le répertoire de contacts (CRM) sans entrée explicite dans la matrice. */
const CONTACT_MANAGER_ROLES = new Set([
  "admin school",
  "directeur",
  "directeur adjoint",
  "proviseur",
  "prefet des etudes",
  "secretaire",
]);

/** Accès CRM établissement (liste blanche legacy). */
export function canManageContactsByRole(role?: string): boolean {
  if (!role) return false;
  if (isSuperAdminRole(role)) return true;
  if (role === COUNTRY_ADMIN_ROLE) return true;
  if (isSchoolAdminRole(role)) return true;
  return CONTACT_MANAGER_ROLES.has(normalize(role));
}

/** Accès au module Contacts : matrice Superadmin + rôles CRM établissement. */
export function canManageContacts(ctx: PermissionContext): boolean {
  return (
    hasPermissionForFeature(ctx, "Contacts", "READ") ||
    hasPermissionForFeature(ctx, "Relations", "READ") ||
    canManageContactsByRole(ctx.user?.role)
  );
}

function hasContactsModulePermission(
  ctx: PermissionContext,
  feature: "Contacts" | "Relations",
  action: string,
): boolean {
  if (hasPermissionForFeature(ctx, feature, action)) return true;
  if (canManageContactsByRole(ctx.user?.role)) return true;
  return false;
}

/** Droits effectifs d'une entité (ex. contact Enseignant = union Contacts + Enseignants). */
export function getEntityFeaturePermissions(
  ctx: PermissionContext,
  moduleKey: string,
  feature: string,
  context: { contactType?: string } = {},
): FeaturePermissions {
  if (moduleKey === "contacts" && normalize(context.contactType) === "enseignant") {
    return {
      canRead:
        hasBackOfficePermission(ctx, "Contacts", "READ") ||
        hasBackOfficePermission(ctx, "Enseignants", "READ"),
      canCreate:
        hasBackOfficePermission(ctx, "Contacts", "CREATE") ||
        hasBackOfficePermission(ctx, "Enseignants", "CREATE"),
      canUpdate:
        hasBackOfficePermission(ctx, "Contacts", "UPDATE") ||
        hasBackOfficePermission(ctx, "Enseignants", "UPDATE"),
      canDelete:
        hasBackOfficePermission(ctx, "Contacts", "DELETE") ||
        hasBackOfficePermission(ctx, "Enseignants", "DELETE"),
      canSuspend:
        hasBackOfficePermission(ctx, "Contacts", "SUSPEND") ||
        hasBackOfficePermission(ctx, "Enseignants", "SUSPEND"),
    };
  }

  return getFeaturePermissions(ctx, feature);
}

export function canAccessSchoolBackOffice(role?: string): boolean {
  if (isSuperAdminRole(role)) return false;
  return isInternalSchoolRole(role);
}

export interface PermissionContext {
  user: SessionUser | null;
  rolePermissions: Record<string, string[]>;
  permissionsReady?: boolean;
  permissionsBootstrap?: "idle" | "loading" | "ready" | "error";
  permissionsBootstrapError?: string | null;
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
  if (Array.isArray(userPermissions)) {
    const merged = [...userPermissions];
    if (isSuperAdminRole(role) && !merged.includes("ALL_PRIVILEGES")) {
      merged.push("ALL_PRIVILEGES");
    }
    if (role === COUNTRY_ADMIN_ROLE) {
      return merged.filter((permission) => permission !== "Pays:CREATE" && permission !== "Pays:DELETE");
    }
    return merged;
  }
  const fromRole = role && Array.isArray(rolePermissions[role]) ? rolePermissions[role] : [];
  const hasCanonicalSource = fromRole.length > 0 || Object.keys(rolePermissions).length > 0;
  const fromDefaults = hasCanonicalSource ? [] : getInternalRoleDefaults(role);
  const merged = [...new Set([...fromRole, ...fromDefaults])];
  if (isSuperAdminRole(role) && !merged.includes("ALL_PRIVILEGES")) {
    merged.push("ALL_PRIVILEGES");
  }
  if (role === COUNTRY_ADMIN_ROLE) {
    return merged.filter(
      (permission) => permission !== "Pays:CREATE" && permission !== "Pays:DELETE",
    );
  }
  return merged;
}

export function getCurrentRolePermissions(ctx: PermissionContext): string[] {
  return resolveEffectivePermissions(ctx.user?.role, ctx.user?.permissions, ctx.rolePermissions);
}

const COUNTRY_PRIVILEGE_FEATURES = new Set(["pays", "etablissements", "abonnements", "utilisateurs", "rapports", "referentiels pedagogiques"]);

function countryPrivilegeAllowsRead(normalizedFeature: string): boolean {
  return COUNTRY_PRIVILEGE_FEATURES.has(normalizedFeature);
}

function matchesPresenceLegacyPermission(normalizedPermission: string, action: string): boolean {
  if (!normalizedPermission.includes("appel")) return false;
  if (action === "READ") return true;
  if (normalizedPermission.includes("gerer")) return true;
  return action === "CREATE" || action === "UPDATE";
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
  if (
    normalizedFeature === "presences" &&
    matchesPresenceLegacyPermission(normalizedPermission, action)
  ) {
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
      normalizedPermission.includes("communications") ||
      normalizedPermission.includes("appel")
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
  return isSuperAdminRole(ctx.user?.role);
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

/** Faire l'appel = création ou mise à jour des présences (legacy « Faire appel » inclus). */
export function canManagePresences(ctx: PermissionContext): boolean {
  return (
    hasBackOfficePermission(ctx, "Présences", "UPDATE") ||
    hasBackOfficePermission(ctx, "Présences", "CREATE")
  );
}

/** Saisie notes = upsert POST /api/notes (CREATE ou UPDATE). */
export function canManageNotes(ctx: PermissionContext): boolean {
  return (
    hasBackOfficePermission(ctx, "Notes", "UPDATE") ||
    hasBackOfficePermission(ctx, "Notes", "CREATE")
  );
}

/** Liaison parent : mêmes jetons que POST /api/parents/link — pas la whitelist CRM. */
export function canLinkParent(ctx: PermissionContext): boolean {
  if (!ctx.user) return false;
  if (isSuperAdminRole(ctx.user.role)) return true;
  if (ctx.user.role === COUNTRY_ADMIN_ROLE) return true;
  const tokens = getCurrentRolePermissions(ctx).map((permission) => normalize(permission));
  return tokens.some(
    (permission) =>
      permission === normalize("ALL_PRIVILEGES") ||
      permission === normalize("COUNTRY_PRIVILEGES") ||
      permission === normalize("Gérer utilisateurs") ||
      permission === normalize("Relations:CREATE"),
  );
}

/** Archivage relation parent-enfant : mêmes jetons que PATCH /api/parents/relations/:id. */
export function canArchiveParentRelation(ctx: PermissionContext): boolean {
  if (canLinkParent(ctx)) return true;
  if (!ctx.user) return false;
  const tokens = getCurrentRolePermissions(ctx).map((permission) => normalize(permission));
  return tokens.some((permission) => permission === normalize("Relations:UPDATE"));
}

/** Admin établissement et rôles habilités peuvent réinitialiser un mot de passe utilisateur. */
export function canResetUserPassword(ctx: PermissionContext): boolean {
  if (!ctx.user) return false;
  if (isSuperAdminRole(ctx.user.role)) return true;
  if (hasBackOfficePermission(ctx, "Utilisateurs", "UPDATE")) return true;
  return getCurrentRolePermissions(ctx).some(
    (permission) => normalize(permission) === normalize("Gérer utilisateurs"),
  );
}

export function canResetTargetUserPassword(
  ctx: PermissionContext,
  target: UserAccount,
): boolean {
  if (!canResetUserPassword(ctx)) return false;
  if (isPendingValidationStatus(target.validationStatus ?? target.status)) {
    return isSuperAdminRole(ctx.user?.role);
  }
  if (isSuperAdminRole(ctx.user?.role)) {
    return canManageUserAccount(ctx.user, target, "UPDATE");
  }
  return canManageUserAccount(ctx.user, target, "UPDATE");
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
    isPlatformCommunicationUser(ctx) &&
    featureList.some((feature) => isPlatformCommunicationFeature(feature))
  ) {
    return true;
  }

  if (featureList.includes("Contacts")) {
    return hasContactsModulePermission(ctx, "Contacts", normalizedAction);
  }
  if (featureList.includes("Relations")) {
    return hasContactsModulePermission(ctx, "Relations", normalizedAction);
  }

  if (
    isSchoolAdminRole(ctx.user.role) &&
    featureList.some((feature) => feature === "Enseignants") &&
    !canSchoolAdminMutateTeachers(normalizedAction) &&
    !hasPermissionForFeature(ctx, "Enseignants", normalizedAction)
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
  if (featureList.includes("Conception bulletins")) {
    return false;
  }

  if (
    ctx.user?.role === COUNTRY_ADMIN_ROLE &&
    featureList.some((feature) => feature === "Pays") &&
    (normalizedAction === "CREATE" || normalizedAction === "DELETE")
  ) {
    return false;
  }

  if (featureList.some((feature) => feature === "Frais & tarifs")) {
    if (normalizedAction === "READ") {
      return canViewFeeGrids(ctx.user) || canViewStudentFees(ctx.user);
    }
    return (
      canManageFeeGrids(ctx.user) &&
      hasPermissionForFeature(ctx, "Frais & tarifs", normalizedAction)
    );
  }

  return featureList.some((feature) => {
    if (!feature) return true;
    return hasPermissionForFeature(ctx, feature, normalizedAction);
  });
}

export function canReadView(ctx: PermissionContext, viewName: string): boolean {
  // Accès au hub Paramètres : Super Admin, Admin School (établissement) et Admin Pays.
  // Le détail des cartes/pages reste filtré par les vues dédiées (configuration, subscriptions…).
  if (viewName === "settings") {
    return (
      isSuperAdminRole(ctx.user?.role) ||
      isSchoolAdminRole(ctx.user?.role) ||
      ctx.user?.role === COUNTRY_ADMIN_ROLE
    );
  }
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
  if (viewName === "mySubscription") {
    if (isSuperAdminRole(ctx.user?.role)) return false;
    return isSchoolAdminRole(ctx.user?.role);
  }
  if (viewName === "bulletinDesign") {
    return canDesignBulletins(ctx);
  }
  if (viewName === "contacts") {
    return hasBackOfficePermission(ctx, "Contacts", "READ");
  }
  if (viewName === "relations") {
    return hasBackOfficePermission(ctx, "Relations", "READ");
  }
  if (
    (viewName === "messages" || viewName === "notifications" || viewName === "announcements") &&
    isPlatformCommunicationUser(ctx)
  ) {
    return true;
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
  if (
    viewName === "messages" ||
    viewName === "notifications" ||
    viewName === "announcements"
  ) {
    if (hasBackOfficePermission(ctx, VIEW_PERMISSION_FEATURES[viewName] ?? null, "READ")) {
      return true;
    }
    return isEstablishmentCommunicationUser(ctx);
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

export function getPermissionRoles(): string[] {
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
