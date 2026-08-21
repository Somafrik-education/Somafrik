import { normalize, isInternalSchoolRole, isSchoolAdminRole } from "../../lib/format";
import { getInternalRoleDefaults } from "../../lib/internalRoleDefaults";
import { canSchoolAdminMutateTeachers } from "../../lib/pedagogyGovernance";
import { attachCanonicalRoleIdentity, resolveCanonicalRoleIdentity } from "../../lib/canonicalRoleIdentity";
import {
  isSuperAdminRole,
  COUNTRY_ADMIN_ROLE,
  sessionRoleToPlatformRole,
} from "../../lib/orgHierarchy";
import { COUNTRY_SCOPE_MODULES } from "../../lib/roleGovernance";
import { SCHOOL_ENTITY_VIEWS, VIEW_PERMISSION_FEATURES, ENTITY_VIEW_MAP } from "../../lib/constants";

export type SecurityAction = "READ" | "CREATE" | "UPDATE" | "DELETE" | "SUSPEND";

export const SUPER_ADMIN_ROLE = "Super Administrateur Somafrik";
export const LEGACY_SUPER_ADMIN_ROLE = "Super Administrateur OKAFRIK";

export function isSuperAdminSessionRole(role?: string) {
  return role === "super_admin" || isSuperAdminRole(role);
}

const schoolAdminForbiddenFeatures = new Set(["Établissements", "Abonnements"]);

/**
 * Parité Web `superAdminAccess.ts` : ALL_PRIVILEGES n'ouvre pas les modules
 * opérationnels d'un établissement dans les interfaces clientes.
 */
export const SUPER_ADMIN_ALLOWED_FEATURES = new Set([
  "Pays",
  "Établissements",
  "Abonnements",
  "Contacts",
  "Relations",
  "Utilisateurs",
  "Référentiels pédagogiques",
  "Notifications",
  "Messages",
  "Paramètres Établissement",
  "Paramètres graphiques",
  "Droits par rôle",
  "Conception bulletins",
]);

/**
 * Vues Mobile explicitement admises pour le Super Admin. Cette liste est
 * volontairement stricte : on ne déduit jamais une vue opérationnelle depuis
 * un alias de feature (ex. Audit -> Utilisateurs, Support -> Messages).
 */
const SUPER_ADMIN_ALLOWED_VIEWS = new Set([
  "overview",
  "countries",
  "educationReference",
  "schools",
  "SchoolManagement",
  "subscriptions",
  "contacts",
  "relations",
  "users",
  "Users",
  "permissions",
  "Permissions",
  "chartSettings",
  "notifications",
  "PlatformNotifications",
  "messages",
  "Messages",
  "announcements",
  "Announcements",
  "configuration",
  "Configuration",
  "bulletinDesign",
]);

function isPlatformCommunicationSession(session: any): boolean {
  const role = session?.role;
  const platformRole = sessionRoleToPlatformRole(role);
  return (
    isSuperAdminSessionRole(role) ||
    role === "country_admin" ||
    platformRole === COUNTRY_ADMIN_ROLE
  );
}

export const entityFeatureMap: Record<string, string> = {
  schools: "Établissements",
  countries: "Pays",
  users: "Utilisateurs",
  classes: "Classes",
  students: "Élèves",
  teachers: "Enseignants",
  payments: "Paiements",
  subscriptions: "Abonnements",
  paymentStatuses: "Paramètres Établissement",
  messages: "Messages",
  announcements: "Notifications",
  courses: "Matières",
  assignments: "Affectations",
};

export const routeFeatureMap: Record<string, string> = {
  Profil: "Élèves",
  StudentDetail: "Élèves",
  StudentNotes: "Notes",
  StudentPresences: "Présences",
  Classes: "Classes",
  Teachers: "Enseignants",
  Students: "Élèves",
  Users: "Utilisateurs",
  TeacherStudents: "Élèves",
  TeacherAttendance: "Présences",
  TeacherGrades: "Notes",
  Notes: "Notes",
  Presences: "Présences",
  FraisEleve: "Paiements",
  StudentPayments: "Paiements",
  SchoolManagement: "Établissements",
  Payments: "Paiements",
  Paiements: "Paiements",
  Messages: "Messages",
  Announcements: "Notifications",
  Timetable: "Planning de cours",
  ReportCards: "Bulletins",
  Documents: "Documents",
  Reports: "Rapports",
  Audit: "Utilisateurs",
  Support: "Messages",
  MobilePayment: "Paiements",
  OfflineMode: "Documents",
  Synchronization: "Documents",
  Configuration: "Paramètres Établissement",
  PlatformNotifications: "Notifications",
  Permissions: "Droits par rôle",
};

const COUNTRY_PRIVILEGE_FEATURES = new Set(["pays", "etablissements", "abonnements", "utilisateurs", "rapports", "referentiels pedagogiques"]);

function countryPrivilegeAllows(normalizedFeature: string, action: SecurityAction) {
  if (!COUNTRY_PRIVILEGE_FEATURES.has(normalizedFeature)) return false;
  if (normalizedFeature === "pays") return action === "READ";
  return true;
}

function matchesPresenceLegacyPermission(normalizedPermission: string, action: SecurityAction): boolean {
  if (!normalizedPermission.includes("appel")) return false;
  if (action === "READ") return true;
  if (normalizedPermission.includes("gerer")) return true;
  return action === "CREATE" || action === "UPDATE";
}

function permissionMatchesFeature(
  normalizedPermission: string,
  normalizedFeature: string,
  action: SecurityAction,
): boolean {
  if (normalizedPermission === "country-privileges") {
    return countryPrivilegeAllows(normalizedFeature, action);
  }
  if (normalizedPermission === "all-privileges") return true;
  if (
    normalizedFeature === "presences" &&
    matchesPresenceLegacyPermission(normalizedPermission, action)
  ) {
    return true;
  }
  if (!normalizedPermission.includes(normalizedFeature)) return false;
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
      normalizedPermission.includes("appel") ||
      normalizedPermission.includes("eleve") ||
      normalizedPermission.includes("note") ||
      normalizedPermission.includes("classe")
    );
  }
  return (
    normalizedPermission.includes(normalize(action)) ||
    normalizedPermission.includes("gerer") ||
    normalizedPermission.includes("crud") ||
    (action === "CREATE" && normalizedPermission.includes("ajouter"))
  );
}

export function resolveEffectivePermissions(
  role: string | undefined,
  userPermissions: string[] | undefined,
  rolePermissions: Record<string, string[]> = {},
): string[] {
  if (Array.isArray(userPermissions)) {
    const merged = [...userPermissions];
    if (isSuperAdminRole(role) && !merged.includes("ALL_PRIVILEGES")) {
      merged.push("ALL_PRIVILEGES");
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
  return merged;
}

export function roleLabelFromSessionRole(role?: string) {
  return sessionRoleToPlatformRole(role);
}

export function getEffectivePermissionsForSession(
  session: any,
  rolePermissions: Record<string, string[]> = {},
): string[] {
  if (!session) return [];
  const identity = resolveCanonicalRoleIdentity(session);
  return resolveEffectivePermissions(
    identity.roleLabel || session.user?.role,
    session.permissions ?? session.user?.permissions,
    session.rolePermissions ?? rolePermissions,
  );
}

export function enrichSessionPermissions(session: any, rolePermissions: Record<string, string[]> = {}) {
  if (!session) return null;
  const identified = attachCanonicalRoleIdentity(session);
  const permissions = getEffectivePermissionsForSession(identified, rolePermissions);
  return {
    ...identified,
    permissions,
    user: {
      ...identified.user,
      permissions,
    },
  };
}

export function buildPermissionSession(session: any) {
  const identified = attachCanonicalRoleIdentity(session) ?? session;
  const identity = resolveCanonicalRoleIdentity(identified);
  const permissions = resolveEffectivePermissions(
    identity.roleLabel,
    identified?.permissions ?? identified?.user?.permissions,
    identified?.rolePermissions ?? {},
  );
  return {
    ...identified,
    permissions,
    platformRole: identity.roleLabel,
  };
}

function hasSecurityPermissionInternal(
  permissions: Set<string>,
  feature: string,
  action: SecurityAction,
): boolean {
  if (permissions.has("ALL_PRIVILEGES")) return true;
  if (permissions.has("COUNTRY_PRIVILEGES") && action === "READ") {
    return countryPrivilegeAllows(normalize(feature), action);
  }
  if (permissions.has(`${feature}:CRUD`)) return true;
  if (action === "READ" && (permissions.has(`${feature}:R`) || permissions.has(`${feature}:READ`))) {
    return true;
  }
  if (permissions.has(`${feature}:${action}`)) return true;

  const normalizedFeature = normalize(feature);
  return [...permissions].some((permission) =>
    permissionMatchesFeature(normalize(permission), normalizedFeature, action),
  );
}

export function hasSecurityPermission(session: any, feature: string | undefined, action: SecurityAction = "READ") {
  if (!feature) return true;
  if (isSuperAdminSessionRole(session?.role)) {
    return SUPER_ADMIN_ALLOWED_FEATURES.has(feature);
  }
  if (
    isPlatformCommunicationSession(session) &&
    (feature === "Messages" || feature === "Notifications")
  ) {
    return true;
  }

  const identity = resolveCanonicalRoleIdentity(session);
  const platformRole = identity.roleLabel;
  if (
    (identity.sessionRole === "school_admin" || isSchoolAdminRole(platformRole)) &&
    schoolAdminForbiddenFeatures.has(feature)
  ) {
    return false;
  }

  if (
    (identity.sessionRole === "school_admin" || isSchoolAdminRole(platformRole)) &&
    feature === "Enseignants" &&
    !canSchoolAdminMutateTeachers(action)
  ) {
    return false;
  }

  const permissions = new Set<string>(getEffectivePermissionsForSession(session));

  if (feature === "Pays") {
    return permissions.has("Contrôler tous les pays") || hasSecurityPermissionInternal(permissions, feature, action);
  }

  if (feature === "Abonnements") {
    return (
      permissions.has("Gérer abonnements") ||
      permissions.has("Suivre abonnements pays") ||
      hasSecurityPermissionInternal(permissions, feature, action)
    );
  }

  return hasSecurityPermissionInternal(permissions, feature, action);
}

/** Faire l'appel = création ou mise à jour des présences (legacy « Faire appel » inclus). */
export function canManagePresences(session: any): boolean {
  return (
    hasSecurityPermission(session, "Présences", "UPDATE") ||
    hasSecurityPermission(session, "Présences", "CREATE")
  );
}

export function canReadView(session: any, viewName: string): boolean {
  if (isSuperAdminSessionRole(session?.role)) {
    return SUPER_ADMIN_ALLOWED_VIEWS.has(viewName);
  }
  if (viewName === "overview") return true;

  if (viewName === "Permissions") {
    return false;
  }

  if (session?.role === "country_admin") {
    if (SCHOOL_ENTITY_VIEWS.has(viewName) || viewName === "establishment" || viewName === "Configuration") {
      return false;
    }
    const feature = VIEW_PERMISSION_FEATURES[viewName];
    if (feature && !COUNTRY_SCOPE_MODULES.has(feature) && feature !== "Rapports") {
      return false;
    }
  }

  if (viewName === "establishment" || viewName === "SchoolManagement") {
    const identity = resolveCanonicalRoleIdentity(session);
    return isInternalSchoolRole(identity.sessionRole) || isInternalSchoolRole(identity.roleLabel);
  }

  if (viewName === "Configuration") {
    const identity = resolveCanonicalRoleIdentity(session);
    if (!isInternalSchoolRole(identity.sessionRole) && !isInternalSchoolRole(identity.roleLabel)) return false;
    return hasSecurityPermission(session, "Paramètres Établissement", "READ");
  }

  const communicationViews = new Set([
    "messages",
    "Messages",
    "notifications",
    "announcements",
    "Announcements",
    "PlatformNotifications",
  ]);
  if (communicationViews.has(viewName)) {
    const feature = VIEW_PERMISSION_FEATURES[viewName] ?? routeFeatureMap[viewName];
    if (feature && hasSecurityPermission(session, feature, "READ")) return true;
    return isPlatformCommunicationSession(session);
  }

  const feature = VIEW_PERMISSION_FEATURES[viewName];
  if (feature === null) return true;
  if (!feature) return hasSecurityPermission(session, routeFeatureMap[viewName], "READ");
  return hasSecurityPermission(session, feature, "READ");
}

export function canReadEntity(session: any, entity?: string) {
  if (!entity) return false;
  const view = ENTITY_VIEW_MAP[entity] ?? entity;
  if (!canReadView(session, view)) return false;
  const feature = entityFeatureMap[entity];
  return Boolean(feature) && hasSecurityPermission(session, feature, "READ");
}

export function canMutateEntity(session: any, entity: string, action: Exclude<SecurityAction, "READ">) {
  const feature = entityFeatureMap[entity];
  const identity = resolveCanonicalRoleIdentity(session);
  if (
    (identity.sessionRole === "school_admin" || isSchoolAdminRole(identity.roleLabel)) &&
    entity === "teachers" &&
    action !== "CREATE"
  ) {
    return false;
  }
  if (
    isPlatformCommunicationSession(session) &&
    (entity === "messages" || entity === "announcements")
  ) {
    return true;
  }
  return Boolean(feature) && hasSecurityPermission(session, feature, action);
}

export function canReadRoute(session: any, routeName?: string) {
  if (isSuperAdminSessionRole(session?.role)) {
    return Boolean(routeName) && SUPER_ADMIN_ALLOWED_VIEWS.has(routeName as string);
  }
  if (routeName && canReadView(session, routeName)) return true;
  const feature = routeName ? routeFeatureMap[routeName] : undefined;
  return Boolean(feature) && hasSecurityPermission(session, feature, "READ");
}

export function matrixPermissions(access: "R" | "CRUD" | "-") {
  if (access === "-") return [];
  const actions: SecurityAction[] = access === "CRUD" ? ["READ", "CREATE", "UPDATE", "DELETE", "SUSPEND"] : ["READ"];
  return actions;
}

export { isSuperAdminRole } from "../../lib/orgHierarchy";
