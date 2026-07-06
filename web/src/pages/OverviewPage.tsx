import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { isInternalSchoolRole } from "../lib/format";
import { canManageRolePermissions } from "../lib/permissions";
import { usePermissionContext } from "../lib/usePermissionContext";
import { scopedUsers } from "../lib/scope";
import { buildEstablishmentDashboardCharts, buildPlatformDashboardCharts } from "../lib/dashboardCharts";
import {
  filterEstablishmentDashboardCharts,
  filterPlatformDashboardCharts,
} from "../lib/dashboardPermissions";
import { DashboardChartGrid } from "../components/charts/DashboardChartGrid";
import { resolveChartOrderUserKey } from "../lib/chartOrder";

export function OverviewPage() {
  const { session } = useAuth();
  const { state } = useData();
  const ctx = usePermissionContext();
  const user = session?.user ?? null;
  const internalSchool = isInternalSchoolRole(user?.role);
  const {
    scopedUser,
  } = useActiveSchool();

  const users = scopedUsers(scopedUser, state);

  const platformCharts = useMemo(() => {
    if (internalSchool) return [];
    return filterPlatformDashboardCharts(
      buildPlatformDashboardCharts(user, state, state.dashboardChartConfig).charts,
      ctx,
    );
  }, [internalSchool, user, state, ctx]);

  const establishmentCharts = useMemo(() => {
    if (!internalSchool) return [];
    return filterEstablishmentDashboardCharts(
      buildEstablishmentDashboardCharts(scopedUser, state, users).charts,
      ctx,
    );
  }, [internalSchool, scopedUser, state, users, ctx]);

  const charts = internalSchool ? establishmentCharts : platformCharts;
  const canConfigureCharts = canManageRolePermissions(ctx);

  const orderScope = internalSchool ? ("establishment" as const) : ("platform" as const);
  const orderUserKey = resolveChartOrderUserKey(internalSchool ? scopedUser : user);

  const periodContext = useMemo(
    () => ({
      user: internalSchool ? scopedUser : user,
      state,
      scope: orderScope,
    }),
    [internalSchool, scopedUser, user, state, orderScope],
  );

  return (
    <div className="space-y-6">
      <DashboardChartGrid
        charts={charts}
        periodContext={periodContext}
        orderScope={orderScope}
        orderUserKey={orderUserKey}
        showTypeBadge={canConfigureCharts}
      />
    </div>
  );
}
