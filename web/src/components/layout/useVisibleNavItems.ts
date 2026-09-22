import {
  NAV_GROUP_ORDER,
  NAV_ITEMS,
  PARENT_NAV_GROUP_ORDER,
  PARENT_NAV_ITEMS,
  type NavItem,
} from "../../lib/constants";
import { canReadFinanceModule } from "../../lib/financeRouteAccess";
import { isInternalSchoolRole, isParentRole } from "../../lib/format";
import {
  canReadView,
  canAccessSchoolBackOffice,
  type PermissionContext,
} from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { useAuth } from "../../context/AuthContext";

export function visibleNavItemsForRole(
  ctx: PermissionContext,
  role?: string,
): NavItem[] {
  const parentRole = isParentRole(role);
  const internalSchool = isInternalSchoolRole(role);
  const schoolBackOffice = canAccessSchoolBackOffice(role);
  const sourceItems = parentRole ? PARENT_NAV_ITEMS : NAV_ITEMS;

  return sourceItems.filter((item) => {
    if (!parentRole && item.schoolOnly && !schoolBackOffice) return false;
    if (!parentRole && internalSchool && (item.view === "users" || item.view === "permissions")) {
      return false;
    }
    if (!parentRole && item.path === "/finances") return canReadFinanceModule(ctx);
    return canReadView(ctx, item.view);
  });
}

export function navigationFooterLabel(input: {
  parentRole: boolean;
  internalSchool: boolean;
  schoolCode?: string;
}) {
  if (input.parentRole) {
    return input.schoolCode
      ? `Espace Parent · ${input.schoolCode}`
      : "Espace Parent";
  }
  if (input.internalSchool && input.schoolCode) {
    return `Établissement · ${input.schoolCode}`;
  }
  return "SaaS multi-pays · multi-établissements";
}

export function useVisibleNavItems() {
  const ctx = usePermissionContext();
  const { session } = useAuth();
  const role = session?.user?.role;
  const internalSchool = isInternalSchoolRole(role);
  const parentRole = isParentRole(role);
  const visible = visibleNavItemsForRole(ctx, role);
  const dashboard = visible.filter((item) => item.group === "dashboard");
  const groupOrder = parentRole ? PARENT_NAV_GROUP_ORDER : NAV_GROUP_ORDER;
  const schoolCode = session?.user?.schoolCode;

  return {
    visible,
    dashboard,
    groupOrder,
    internalSchool,
    parentRole,
    schoolCode,
    footerLabel: navigationFooterLabel({
      parentRole,
      internalSchool,
      schoolCode,
    }),
  };
}

export type { NavItem };
