import type { PermissionContext } from "./permissions";
import { hasBackOfficePermission } from "./permissions";
import { canManageFeeGrids, canViewFeeGrids, canViewStudentFees } from "./fees";

export const FEE_FEATURE = "Frais & tarifs";

export function canReadFees(ctx: PermissionContext): boolean {
  if (canViewFeeGrids(ctx.user)) return true;
  return hasBackOfficePermission(ctx, FEE_FEATURE, "READ");
}

export function canCreateFees(ctx: PermissionContext): boolean {
  if (!canManageFeeGrids(ctx.user)) return false;
  return hasBackOfficePermission(ctx, FEE_FEATURE, "CREATE");
}

export function canUpdateFees(ctx: PermissionContext): boolean {
  if (!canManageFeeGrids(ctx.user)) return false;
  return hasBackOfficePermission(ctx, FEE_FEATURE, "UPDATE");
}

export function canApplyFees(ctx: PermissionContext): boolean {
  return canUpdateFees(ctx);
}

export function canReadStudentFeeBalance(ctx: PermissionContext): boolean {
  if (canViewStudentFees(ctx.user)) return true;
  return canReadFees(ctx);
}
