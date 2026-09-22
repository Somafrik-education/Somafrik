import { NAV_ITEMS, type NavItem } from "../../lib/constants";
import { canReadFinanceModule } from "../../lib/financeRouteAccess";
import { isInternalSchoolRole, isParentRole } from "../../lib/format";
import { canReadView, canAccessSchoolBackOffice } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { useAuth } from "../../context/AuthContext";

export function useVisibleNavItems() {
  const ctx = usePermissionContext();
  const { session } = useAuth();
  const role = session?.user?.role;
  const internalSchool = isInternalSchoolRole(role);
  const parentRole = isParentRole(role);
  const schoolBackOffice = canAccessSchoolBackOffice(role);

  const parentProfileItem: NavItem = {
    view: "parentProfile",
    path: "/mon-profil",
    label: "Mon profil",
    group: "dashboard",
  };
  const parentViews = new Set(["overview", "presences", "notes", "bulletins", "payments"]);
  const sourceItems = parentRole
    ? [parentProfileItem, ...NAV_ITEMS.filter((item) => parentViews.has(item.view))]
    : NAV_ITEMS;

  const visible = sourceItems.filter((item) => {
    if (item.schoolOnly && !schoolBackOffice && !parentRole) return false;
    if (internalSchool && (item.view === "users" || item.view === "permissions")) return false;
    if (item.path === "/finances") return canReadFinanceModule(ctx);
    return canReadView(ctx, item.view);
  });

  const dashboard = visible.filter((item) => item.group === "dashboard");

  return {
    visible,
    dashboard,
    internalSchool,
    schoolCode: session?.user?.schoolCode,
  };
}

export type { NavItem };
