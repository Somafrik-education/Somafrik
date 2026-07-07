import type { PermissionContext } from "./permissions";
import { hasBackOfficePermission } from "./permissions";
import { normalize } from "./format";
import { isSuperAdminRole, COUNTRY_ADMIN_ROLE } from "./orgHierarchy";
import { isSchoolAdminRole } from "./format";

export const UNPAID_FEATURE = "Impayés";

function isTeacherRole(role?: string): boolean {
  const value = normalize(role ?? "");
  return value === "enseignant" || value.includes("prof");
}

function isParentOrStudentRole(role?: string): boolean {
  const value = normalize(role ?? "");
  return value.includes("parent") || value.includes("eleve") || value.includes("etudiant");
}

/** IMP-020 — accès module impayés (enseignants exclus). */
export function canAccessUnpaidModule(ctx: PermissionContext): boolean {
  const user = ctx.user;
  if (!user) return false;
  if (isTeacherRole(user.role)) return false;
  if (isSuperAdminRole(user.role) || user.role === COUNTRY_ADMIN_ROLE) return true;
  if (isParentOrStudentRole(user.role)) return true;
  if (isSchoolAdminRole(user.role) || normalize(user.role) === "comptable") return true;
  if (normalize(user.role) === "secretaire" || normalize(user.role) === "directeur") return true;
  return hasBackOfficePermission(ctx, UNPAID_FEATURE, "READ");
}

/** Vue globale établissement (pas limitée au propre dossier). */
export function canViewAllUnpaid(ctx: PermissionContext): boolean {
  const user = ctx.user;
  if (!user || isTeacherRole(user.role)) return false;
  if (isParentOrStudentRole(user.role)) return false;
  return canAccessUnpaidModule(ctx);
}

/** IMP-009, IMP-010 — envoi de relances. */
export function canSendUnpaidReminder(ctx: PermissionContext): boolean {
  const user = ctx.user;
  if (!user || isTeacherRole(user.role) || isParentOrStudentRole(user.role)) return false;
  if (isSuperAdminRole(user.role) || isSchoolAdminRole(user.role) || normalize(user.role) === "comptable") {
    return true;
  }
  return hasBackOfficePermission(ctx, UNPAID_FEATURE, "CREATE");
}

/** Parent / élève — uniquement sa propre situation (IMP-020). */
export function isOwnUnpaidScopeOnly(ctx: PermissionContext): boolean {
  return isParentOrStudentRole(ctx.user?.role);
}
