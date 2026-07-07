import type { PermissionContext } from "./permissions";
import { isInternalSchoolRole, normalize } from "./format";
import { COUNTRY_ADMIN_ROLE, isSuperAdminRole } from "./orgHierarchy";

const PARENT_STUDENT_ROLES = new Set(["parent", "eleve / etudiant", "eleve", "etudiant"]);

export type CommunicationView = "messages" | "notifications" | "announcements";

export const PLATFORM_COMMUNICATION_VIEWS = new Set<CommunicationView>([
  "messages",
  "notifications",
  "announcements",
]);

const PLATFORM_COMMUNICATION_FEATURES = new Set(["Messages", "Notifications"]);

/** Super Admin / Admin Pays : notifications système, messages et annonces plateforme. */
export function isPlatformCommunicationUser(ctx: PermissionContext): boolean {
  const role = ctx.user?.role;
  if (!role) return false;
  return isSuperAdminRole(role) || role === COUNTRY_ADMIN_ROLE;
}

export function isPlatformCommunicationFeature(feature: string | null | undefined): boolean {
  return Boolean(feature && PLATFORM_COMMUNICATION_FEATURES.has(feature));
}

/** Utilisateur rattaché à un établissement (personnel, parent ou élève). */
export function isEstablishmentCommunicationUser(ctx: PermissionContext): boolean {
  const user = ctx.user;
  if (!user?.schoolCode || user.schoolCode === "*") return false;
  const roleKey = normalize(user.role);
  return isInternalSchoolRole(user.role) || PARENT_STUDENT_ROLES.has(roleKey);
}
