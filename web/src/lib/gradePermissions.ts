import type { PermissionContext } from "./permissions";
import { hasBackOfficePermission } from "./permissions";
import type { SessionUser } from "../types";
import { isSuperAdminRole } from "./orgHierarchy";
import { normalize } from "./format";

export const GRADES_FEATURE = "Notes";

export function canReadGrades(ctx: PermissionContext): boolean {
  return hasBackOfficePermission(ctx, GRADES_FEATURE, "READ");
}

export function canCreateGrades(ctx: PermissionContext): boolean {
  return hasBackOfficePermission(ctx, GRADES_FEATURE, "CREATE");
}

export function canUpdateGrades(ctx: PermissionContext): boolean {
  return hasBackOfficePermission(ctx, GRADES_FEATURE, "UPDATE");
}

export function canValidateGrades(user: SessionUser | null): boolean {
  if (!user) return false;
  const role = normalize(user.role);
  if (isSuperAdminRole(user.role) && user.schoolCode !== "*") return true;
  return (
    role.includes("prefet") ||
    role.includes("proviseur") ||
    role.includes("directeur") ||
    role.includes("admin")
  );
}

export function canCorrectValidatedGrades(user: SessionUser | null): boolean {
  return canValidateGrades(user);
}

export function canExportGrades(ctx: PermissionContext): boolean {
  return canReadGrades(ctx) && (canUpdateGrades(ctx) || canValidateGrades(ctx.user));
}

export function canPublishGrades(user: SessionUser | null): boolean {
  return canValidateGrades(user);
}
