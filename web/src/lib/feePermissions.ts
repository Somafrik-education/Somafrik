import type { PermissionContext } from "./permissions";
import { hasBackOfficePermission } from "./permissions";

export const FEE_FEATURE = "Frais & tarifs";

export function canReadFees(ctx: PermissionContext): boolean {
  return hasBackOfficePermission(ctx, FEE_FEATURE, "READ");
}

/** POST /api/finance/fee-grids — F6 : CREATE | UPDATE. Activation / application restent UPDATE. */
export function canCreateFees(ctx: PermissionContext): boolean {
  return (
    hasBackOfficePermission(ctx, FEE_FEATURE, "CREATE") ||
    hasBackOfficePermission(ctx, FEE_FEATURE, "UPDATE")
  );
}

export function canUpdateFees(ctx: PermissionContext): boolean {
  return hasBackOfficePermission(ctx, FEE_FEATURE, "UPDATE");
}

export function canApplyFees(ctx: PermissionContext): boolean {
  return canUpdateFees(ctx);
}

export function canReadStudentFeeBalance(ctx: PermissionContext): boolean {
  return (
    canReadFees(ctx) ||
    hasBackOfficePermission(ctx, "Paiements", "READ") ||
    hasBackOfficePermission(ctx, "Impayés", "READ")
  );
}
