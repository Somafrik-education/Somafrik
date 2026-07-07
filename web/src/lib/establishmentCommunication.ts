import type { PermissionContext } from "./permissions";
import { isInternalSchoolRole, normalize } from "./format";

const PARENT_STUDENT_ROLES = new Set(["parent", "eleve / etudiant", "eleve", "etudiant"]);

export type CommunicationView = "messages" | "notifications" | "announcements";

/** Utilisateur rattaché à un établissement (personnel, parent ou élève). */
export function isEstablishmentCommunicationUser(ctx: PermissionContext): boolean {
  const user = ctx.user;
  if (!user?.schoolCode || user.schoolCode === "*") return false;
  const roleKey = normalize(user.role);
  return isInternalSchoolRole(user.role) || PARENT_STUDENT_ROLES.has(roleKey);
}
