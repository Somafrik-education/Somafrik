import type { PlatformChart, EstablishmentChart } from "./dashboardCharts";
import type { PermissionContext } from "./permissions";
import { hasBackOfficePermission } from "./permissions";

const PLATFORM_CHART_FEATURES: Record<string, string | null> = {
  structure: "__structure__",
  kpis: "__kpis__",
  "school-status": "Établissements",
  "schools-country": "Établissements",
  "subscription-payment": "Abonnements",
  "subscription-plans": "Abonnements",
  "subscription-gauge": "Abonnements",
};

const STRUCTURE_SEGMENT_FEATURES: Record<string, string> = {
  Pays: "Pays",
  Établissements: "Établissements",
  Utilisateurs: "Utilisateurs",
  "Utilisateurs actifs": "Utilisateurs",
};

const KPI_LABEL_FEATURES: Record<string, string | null> = {
  Pays: "Pays",
  Établissements: "Établissements",
  "Utilisateurs actifs": "Utilisateurs",
  "Revenus mensuels": "Abonnements",
  "Alertes plateforme": "Abonnements",
  "Élèves suivis": "Élèves",
  Enseignants: "Enseignants",
  "Alertes à traiter": "Notifications",
  "Présence du jour": "Présences",
  "Taux de paiement": "Paiements",
};

const ESTABLISHMENT_CHART_FEATURES: Record<string, string | string[]> = {
  scolarite: ["Élèves", "Enseignants", "Classes"],
  "scolarite-finance": ["Élèves", "Classes"],
  "scolarite-ops": ["Élèves", "Classes"],
  "academic-bar": ["Notes", "Examens", "Bulletins"],
  academic: ["Notes", "Examens", "Bulletins"],
  "notes-course": "Notes",
  "presence-rate": "Présences",
  "presence-donut": "Présences",
  "presence-gauge": "Présences",
  "payments-status": "Paiements",
  "payments-amount": "Paiements",
  payments: "Paiements",
  operations: ["Utilisateurs", "Documents", "Présences", "Messages"],
  "operations-default": ["Utilisateurs", "Documents", "Présences"],
  "class-sizes": "Élèves",
  classes: "Élèves",
};

function canReadAny(ctx: PermissionContext, features: string | string[]): boolean {
  const list = Array.isArray(features) ? features : [features];
  return list.some((feature) => hasBackOfficePermission(ctx, feature, "READ"));
}

function filterChartDataByLabels<T extends { name: string; value: number }>(
  data: T[],
  labelFeatures: Record<string, string>,
  ctx: PermissionContext,
): T[] {
  return data.filter((item) => {
    const feature = labelFeatures[item.name];
    if (!feature) return true;
    return hasBackOfficePermission(ctx, feature, "READ");
  });
}

export function filterPlatformDashboardCharts(
  charts: PlatformChart[],
  ctx: PermissionContext,
): PlatformChart[] {
  return charts
    .map((chart) => {
      const rule = PLATFORM_CHART_FEATURES[chart.id];
      if (rule === "__structure__") {
        const data = filterChartDataByLabels(chart.data, STRUCTURE_SEGMENT_FEATURES, ctx);
        return data.length ? { ...chart, data } : null;
      }
      if (rule === "__kpis__") {
        const data = chart.data.filter((item) => {
          const feature = KPI_LABEL_FEATURES[item.name];
          if (!feature) return true;
          return hasBackOfficePermission(ctx, feature, "READ");
        });
        return data.length ? { ...chart, data } : null;
      }
      if (rule && !hasBackOfficePermission(ctx, rule, "READ")) {
        return null;
      }
      return chart;
    })
    .filter((chart): chart is PlatformChart => chart !== null);
}

export function filterEstablishmentDashboardCharts(
  charts: EstablishmentChart[],
  ctx: PermissionContext,
): EstablishmentChart[] {
  return charts.filter((chart) => {
    const rule = ESTABLISHMENT_CHART_FEATURES[chart.id];
    if (!rule) return true;
    return canReadAny(ctx, rule);
  });
}

export function describeDashboardAccess(ctx: PermissionContext) {
  const readableModules = [
    "Pays",
    "Établissements",
    "Abonnements",
    "Utilisateurs",
    "Classes",
    "Élèves",
    "Enseignants",
    "Présences",
    "Notes",
    "Examens",
    "Bulletins",
    "Paiements",
    "Documents",
    "Messages",
    "Notifications",
    "Rapports",
  ].filter((feature) => hasBackOfficePermission(ctx, feature, "READ"));

  return { readableModules };
}
