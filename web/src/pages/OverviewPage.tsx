import { useEffect, useMemo, useState } from "react";
import { LoadingState, ErrorState } from "@/design-system";
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

type DemoCriticalStatus = "idle" | "loading" | "ready" | "error";

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
  const [demoCriticalStatus, setDemoCriticalStatus] = useState<DemoCriticalStatus>(
    demoRuntimeEnabled ? "idle" : "ready",
  );

  useEffect(() => {
    if (!demoRuntimeEnabled || !session?.accessToken) {
      setDemoCriticalStatus(demoRuntimeEnabled ? "idle" : "ready");
      return;
    }

    let cancelled = false;
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

    setDemoCriticalStatus("loading");

    // Démo uniquement : les domaines critiques (élèves, enseignants, classes)
    // restent progressifs côté réseau mais le graphique ne publie plus une
    // valeur partielle comme « 10 élèves » avant la fin des trois GET.
    const criticalTasks = critical.map((domain) => ensureDomains([domain], options));
    void Promise.allSettled(criticalTasks).then((results) => {
      if (cancelled) return;
      const failed = results.some((result) => result.status === "rejected");
      setDemoCriticalStatus(failed ? "error" : "ready");
    });

    // Les domaines secondaires continuent à hydrater indépendamment : ils ne
    // bloquent pas la première vue cohérente du tableau de bord.
    for (const domain of deferred) {
      void ensureDomains([domain], options).catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
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

  if (demoRuntimeEnabled && demoCriticalStatus !== "ready") {
    if (demoCriticalStatus === "error") {
      return (
        <ErrorState
          title="Impossible de charger le tableau de bord."
          message="Les effectifs critiques de démonstration n'ont pas pu être hydratés complètement."
        />
      );
    }
    return <LoadingState message="Chargement des effectifs de démonstration…" />;
  }

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
