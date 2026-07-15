import { NAV_ITEMS, type NavItem } from "../../lib/constants";
import { isInternalSchoolRole } from "../../lib/format";
import { canReadView, canAccessSchoolBackOffice } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { useAuth } from "../../context/AuthContext";

export function useVisibleNavItems() {
  const ctx = usePermissionContext();
  const { session } = useAuth();
  const role = session?.user?.role;
  const internalSchool = isInternalSchoolRole(role);
  const schoolBackOffice = canAccessSchoolBackOffice(role);

  const visible = NAV_ITEMS.filter((item) => {
    if (item.schoolOnly && !schoolBackOffice) return false;
    if (internalSchool && (item.view === "users" || item.view === "permissions")) return false;
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
