import type { PermissionContext } from "./permissions";
import { hasBackOfficePermission } from "./permissions";

export const UNPAID_FEATURE = "Impayés";

export function canAccessUnpaidModule(ctx: PermissionContext): boolean {
  return hasBackOfficePermission(ctx, UNPAID_FEATURE, "READ");
}

export function canViewAllUnpaid(ctx: PermissionContext): boolean {
  return (
    canAccessUnpaidModule(ctx) &&
    (hasBackOfficePermission(ctx, UNPAID_FEATURE, "CREATE") ||
      hasBackOfficePermission(ctx, UNPAID_FEATURE, "UPDATE") ||
      hasBackOfficePermission(ctx, "Paiements", "READ"))
  );
}

/** POST unpaid reminders — F6 : Impayés:CREATE | Paiements:UPDATE. */
export function canSendUnpaidReminder(ctx: PermissionContext): boolean {
  return (
    hasBackOfficePermission(ctx, UNPAID_FEATURE, "CREATE") ||
    hasBackOfficePermission(ctx, "Paiements", "UPDATE")
  );
}

/** Dossier personnel : lecture Impayés sans mutation ni vue établissement. */
export function isOwnUnpaidScopeOnly(ctx: PermissionContext): boolean {
  return canAccessUnpaidModule(ctx) && !canViewAllUnpaid(ctx);
}
