import { useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { isInternalSchoolRole } from "../lib/format";
import { canManageRolePermissions, hasBackOfficePermission } from "../lib/permissions";
import { usePermissionContext } from "../lib/usePermissionContext";
import { scopedUsers } from "../lib/scope";
import { useInternalNotificationsUnreadCount } from "../lib/internalNotificationsRead";
import { buildEstablishmentDashboardCharts, buildPlatformDashboardCharts } from "../lib/dashboardCharts";
import {
  filterEstablishmentDashboardCharts,
  filterPlatformDashboardCharts,
} from "../lib/dashboardPermissions";
import { DashboardChartGrid } from "../components/charts/DashboardChartGrid";
import { resolveChartOrderUserKey } from "../lib/chartOrder";
import { demoRuntimeEnabled } from "../lib/featureFlags";
import {
  dashboardCriticalDomainsForDemo,
  dashboardDeferredDomainsForDemo,
} from "../lib/dashboardDemoHydration";
import { filterDomainsByPermissions } from "../lib/domainPermissions";

export function OverviewPage() {
  const { session } = useAuth();
  const { state, ensureDomains } = useData();
  const ctx = usePermissionContext();
  const user = session?.user ?? null;
  const internalSchool = isInternalSchoolRole(user?.role);
  const {
    scopedUser,
    activeSchoolCode,
  } = useActiveSchool();

  useEffect(() => {
    if (!demoRuntimeEnabled || !session?.accessToken) return;

    const options =
      internalSchool && activeSchoolCode && activeSchoolCode !== "*"
        ? { schoolCode: activeSchoolCode }
        : undefined;

    const critical = filterDomainsByPermissions(
      dashboardCriticalDomainsForDemo(internalSchool),
      ctx,
    ).filter((domain) => domain !== "schools");
    const deferred = filterDomainsByPermissions(
      dashboardDeferredDomainsForDemo(internalSchool),
      ctx,
    );

    // Démo uniquement : chaque domaine est fusionné dès que son GET termine.
    // L'école est déjà fournie par /api/demo/exchange ; on ne refait pas le
    // snapshot établissement. Un endpoint lent (ex. users) ne retient donc
    // plus classes, élèves, présences ou notes derrière un batch atomique.
    for (const domain of critical) {
      void ensureDomains([domain], options).catch(() => undefined);
    }
    for (const domain of deferred) {
      void ensureDomains([domain], options).catch(() => undefined);
    }
  }, [session?.accessToken, internalSchool, activeSchoolCode, ensureDomains, ctx]);

  const hasInternalNotificationScope = Boolean(activeSchoolCode && activeSchoolCode !== "*");
  const schoolUnreadCount = useInternalNotificationsUnreadCount(
    Boolean(
      internalSchool &&
        hasBackOfficePermission(ctx, "Notifications", "READ") &&
        hasInternalNotificationScope,
    ),
    activeSchoolCode,
  );

  const users = scopedUsers(scopedUser, state);

  const platformCharts = useMemo(() => {
    if (internalSchool) return [];
    return filterPlatformDashboardCharts(
      buildPlatformDashboardCharts(user, state, state.dashboardChartConfig, { schoolUnreadCount }).charts,
      ctx,
    );
  }, [internalSchool, user, state, ctx, schoolUnreadCount]);

  const establishmentCharts = useMemo(() => {
    if (!internalSchool) return [];
    return filterEstablishmentDashboardCharts(
      buildEstablishmentDashboardCharts(scopedUser, state, users, { schoolUnreadCount }).charts,
      ctx,
    );
  }, [internalSchool, scopedUser, state, users, ctx, schoolUnreadCount]);

  const charts = internalSchool ? establishmentCharts : platformCharts;
  const canConfigureCharts = canManageRolePermissions(ctx);

  const orderScope = internalSchool ? ("establishment" as const) : ("platform" as const);
  const orderUserKey = resolveChartOrderUserKey(internalSchool ? scopedUser : user);

  const periodContext = useMemo(
    () => ({
      user: internalSchool ? scopedUser : user,
      state,
      scope: orderScope,
      schoolUnreadCount,
      permissionCtx: ctx,
    }),
    [internalSchool, scopedUser, user, state, orderScope, schoolUnreadCount, ctx],
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
