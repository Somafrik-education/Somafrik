import { useEffect, useMemo, useState } from "react";
import { EstablishmentDashboardLayout } from "../components/dashboard/EstablishmentDashboardLayout";
import { EstablishmentChartSwitcher } from "../components/dashboard/EstablishmentChartSwitcher";
import { getEstablishmentMetrics } from "../lib/establishment";
import { scopedPayments } from "../lib/establishment";
import { getPaymentCashBreakdown } from "../lib/paymentCashKpi";
import { LoadingState, ErrorState } from "@/design-system";
import { GuidedSchoolSetupDashboardCard } from "../components/schoolSetup/GuidedSchoolSetupDashboardCard";
import { schoolSetupGuidedApi, type GuidedSetupPayload } from "../lib/schoolSetupGuidedApi";
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
  const [guidedPayload, setGuidedPayload] = useState<GuidedSetupPayload | null>(null);

  useEffect(() => {
    if (!session?.accessToken) return;
    let cancelled = false;
    void schoolSetupGuidedApi
      .get()
      .then((row) => {
        if (!cancelled) setGuidedPayload(row);
      })
      .catch(() => {
        if (!cancelled) setGuidedPayload(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

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
  const establishmentMetrics = useMemo(() => internalSchool ? getEstablishmentMetrics(scopedUser, state, users) : null, [internalSchool, scopedUser, state, users]);
  const revenue = useMemo(() => {
    if (!internalSchool || !hasBackOfficePermission(ctx, "Paiements", "READ")) return "—";
    const buckets = getPaymentCashBreakdown(scopedPayments(scopedUser, state));
    if (buckets.length !== 1 || !buckets[0].currencyKey) return "—";
    return `${new Intl.NumberFormat("fr-FR").format(buckets[0].collectedAmount)} ${buckets[0].currencyLabel}`;
  }, [internalSchool, scopedUser, state, ctx]);

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
      {guidedPayload ? (
        <GuidedSchoolSetupDashboardCard payload={guidedPayload} role={user?.role} />
      ) : null}
      {internalSchool && establishmentMetrics ? (
        <EstablishmentDashboardLayout
          students={establishmentMetrics.students}
          teachers={establishmentMetrics.teachers}
          classes={establishmentMetrics.classes}
          revenue={revenue}
          canReadStudents={hasBackOfficePermission(ctx, "Élèves", "READ")}
          canReadTeachers={hasBackOfficePermission(ctx, "Enseignants", "READ")}
          canReadClasses={hasBackOfficePermission(ctx, "Classes", "READ")}
          canReadPayments={hasBackOfficePermission(ctx, "Paiements", "READ")}
          activitiesEnabled={user?.role === "Admin School"}
          schoolKey={activeSchoolCode ?? ""}
        >
          <EstablishmentChartSwitcher
            charts={establishmentCharts}
            periodContext={periodContext}
            orderUserKey={orderUserKey}
            showTypeBadge={canConfigureCharts}
          />
        </EstablishmentDashboardLayout>
      ) : (
        <DashboardChartGrid
          charts={charts}
          periodContext={periodContext}
          orderScope={orderScope}
          orderUserKey={orderUserKey}
          showTypeBadge={canConfigureCharts}
        />
      )}
    </div>
  );
}
