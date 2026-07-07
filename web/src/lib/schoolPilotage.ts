import type { BackOfficeState } from "../types";
import { DEFAULT_USER_ROLES, getSchoolAcademicLists } from "./academicConfig";
import { CRUD_ACTIONS } from "./constants";
import { normalize } from "./format";
import { isPlatformBackOfficeRole } from "./orgHierarchy";
import { hasBackOfficePermission, type PermissionContext } from "./permissions";

export const DELEGABLE_SCHOOL_FEATURES = [
  "Contacts",
  "Relations",
  "Utilisateurs",
  "Classes",
  "Élèves",
  "Enseignants",
  "Planning de cours",
  "Présences",
  "Notes",
  "Bulletins",
  "Paiements",
  "Notifications",
  "Messages",
  "Documents",
  "Rapports",
  "Années Académiques",
  "Matières",
  "Examens",
  "Paramètres Établissement",
] as const;

export function getDelegableActionsForFeature(ctx: PermissionContext, feature: string) {
  return CRUD_ACTIONS.filter((action) => hasBackOfficePermission(ctx, feature, action.key));
}

export function getDelegableSchoolFeatures(ctx: PermissionContext): string[] {
  return DELEGABLE_SCHOOL_FEATURES.filter(
    (feature) => getDelegableActionsForFeature(ctx, feature).length > 0,
  );
}

export function getSchoolPilotageRoles(
  state: Pick<BackOfficeState, "academicConfigs">,
  schoolCode?: string,
): string[] {
  return getSchoolAcademicLists(state, schoolCode).userRoles;
}

/** Détecte un renommage de rôle (ligne modifiée ou remplacement unique). */
export function detectRoleRenames(oldRoles: string[], newRoles: string[]): Record<string, string> {
  const migrations: Record<string, string> = {};

  for (let index = 0; index < Math.min(oldRoles.length, newRoles.length); index += 1) {
    const oldRole = oldRoles[index];
    const newRole = newRoles[index];
    if (oldRole && newRole && oldRole !== newRole && !migrations[oldRole]) {
      migrations[oldRole] = newRole;
    }
  }

  const removed = oldRoles.filter((role) => !newRoles.includes(role));
  const added = newRoles.filter((role) => !oldRoles.includes(role));
  if (removed.length === 1 && added.length === 1 && !migrations[removed[0]]) {
    migrations[removed[0]] = added[0];
  }

  return migrations;
}

export function applyRoleRenames(
  state: BackOfficeState,
  migrations: Record<string, string>,
): Pick<BackOfficeState, "rolePermissions" | "users"> {
  if (!Object.keys(migrations).length) {
    return { rolePermissions: state.rolePermissions, users: state.users };
  }

  const rolePermissions = { ...state.rolePermissions };
  for (const [oldRole, newRole] of Object.entries(migrations)) {
    if (rolePermissions[oldRole] !== undefined) {
      rolePermissions[newRole] = rolePermissions[oldRole];
      delete rolePermissions[oldRole];
    }
  }

  const users = state.users.map((user) => {
    if (!user.role || !migrations[user.role]) return user;
    const nextRole = migrations[user.role];
    return {
      ...user,
      role: nextRole,
      permissions: rolePermissions[nextRole] ?? user.permissions,
    };
  });

  return { rolePermissions, users };
}

/** Retrouve la clé rolePermissions (y compris ancien libellé avant renommage). */
export function resolveRolePermissionKey(
  role: string,
  userRoles: string[],
  rolePermissions: Record<string, string[]>,
): string {
  if (rolePermissions[role]?.length) return role;

  const index = userRoles.indexOf(role);
  if (index >= 0 && index < DEFAULT_USER_ROLES.length) {
    const legacyRole = DEFAULT_USER_ROLES[index];
    if (legacyRole !== role && rolePermissions[legacyRole]?.length) {
      return legacyRole;
    }
  }

  const normalizedRole = normalize(role);
  for (const [legacyRole, permissions] of Object.entries(rolePermissions)) {
    if (permissions.length && !userRoles.includes(legacyRole) && normalize(legacyRole) === normalizedRole) {
      return legacyRole;
    }
  }

  return role;
}

export function readRolePermissions(
  role: string,
  userRoles: string[],
  rolePermissions: Record<string, string[]>,
): string[] {
  const key = resolveRolePermissionKey(role, userRoles, rolePermissions);
  return rolePermissions[key] ?? rolePermissions[role] ?? [];
}

export function toggleSchoolRolePermission(
  state: BackOfficeState,
  role: string,
  permission: string,
  enabled: boolean,
  ctx?: PermissionContext,
): BackOfficeState | null {
  if (!isSchoolRolePermissionAllowed(permission)) {
    return null;
  }
  if (ctx) {
    const [feature, action = "READ"] = permission.split(":");
    if (!hasBackOfficePermission(ctx, feature, action)) {
      return null;
    }
  }

  const current = new Set(state.rolePermissions[role] ?? []);
  if (enabled) current.add(permission);
  else current.delete(permission);

  const nextRolePermissions = {
    ...state.rolePermissions,
    [role]: [...current].sort((a, b) => a.localeCompare(b, "fr")),
  };

  const nextUsers = state.users.map((user) =>
    user.role === role ? { ...user, permissions: nextRolePermissions[role] } : user,
  );

  return { ...state, rolePermissions: nextRolePermissions, users: nextUsers };
}

export function canDelegateSchoolPermission(ctx: PermissionContext, permission: string): boolean {
  if (!isSchoolRolePermissionAllowed(permission)) return false;
  const [feature, action = "READ"] = permission.split(":");
  return hasBackOfficePermission(ctx, feature, action);
}

export function isSchoolRolePermissionAllowed(permission: string): boolean {
  if (!permission || permission === "ALL_PRIVILEGES" || permission === "COUNTRY_PRIVILEGES") {
    return false;
  }
  const [feature] = permission.split(":");
  const normalizedFeature = normalize(feature);
  if (["pays", "etablissements", "abonnements"].includes(normalizedFeature)) {
    return false;
  }
  const normalizedPermission = normalize(permission);
  const forbiddenKeywords = normalizedPermission.startsWith("frais & tarifs")
    ? ["abonnement", "inscription"]
    : ["abonnement", "inscription", "tarif"];
  return !forbiddenKeywords.some((keyword) => normalizedPermission.includes(keyword));
}

/** Retire les droits non déléguables du pilotage établissement. */
export function sanitizeSchoolRolePermissions(
  rolePermissions: Record<string, string[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(rolePermissions)
      .filter(([role]) => !isPlatformBackOfficeRole(role))
      .map(([role, permissions]) => [
        role,
        permissions.filter((permission) => isSchoolRolePermissionAllowed(permission)),
      ]),
  );
}

/** Fusionne uniquement les rôles locaux définis par l'établissement. */
export function mergeLocalRolePermissions(
  current: Record<string, string[]>,
  draft: Record<string, string[]>,
  localRoles: string[],
): Record<string, string[]> {
  const sanitized = sanitizeSchoolRolePermissions(draft);
  const next = { ...current };
  for (const role of localRoles) {
    if (Array.isArray(sanitized[role])) {
      next[role] = sanitized[role];
    }
  }
  return next;
}
