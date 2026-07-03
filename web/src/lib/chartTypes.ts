export type ChartType =
  | "line"
  | "bar"
  | "bar-horizontal"
  | "donut"
  | "pie"
  | "area"
  | "stacked-bar"
  | "gauge";

export interface DashboardChartConfig {
  platform: Record<string, ChartType>;
  establishment: Record<string, ChartType>;
}

export const EMPTY_DASHBOARD_CHART_CONFIG: DashboardChartConfig = {
  platform: {},
  establishment: {},
};

export const SUPERADMIN_CHART_TYPE_OPTIONS: Array<{
  value: ChartType;
  label: string;
  emoji: string;
}> = [
  { value: "line", label: "Courbes (Line Chart)", emoji: "📈" },
  { value: "bar", label: "Barres (Bar Chart)", emoji: "📊" },
  { value: "donut", label: "Donut Chart", emoji: "🍩" },
  { value: "pie", label: "Pie Chart", emoji: "🥧" },
  { value: "area", label: "Area Chart", emoji: "📉" },
  { value: "stacked-bar", label: "Stacked Bar", emoji: "📊" },
];

const VALID_CHART_TYPES = new Set<ChartType>([
  "line",
  "bar",
  "bar-horizontal",
  "donut",
  "pie",
  "area",
  "stacked-bar",
  "gauge",
]);

export function normalizeChartType(value: unknown): ChartType | null {
  const key = String(value ?? "").trim() as ChartType;
  return VALID_CHART_TYPES.has(key) ? key : null;
}

export function resolveChartType(
  chartId: string,
  defaultType: ChartType,
  config: DashboardChartConfig | undefined,
  scope: "platform" | "establishment",
): ChartType {
  const overrides = scope === "platform" ? config?.platform : config?.establishment;
  const override = normalizeChartType(overrides?.[chartId]);
  if (!override) return defaultType;
  if (defaultType === "gauge" && override !== "gauge") return override;
  return override;
}

export function applyChartTypeOverrides<T extends { id: string; type: ChartType }>(
  charts: T[],
  config: DashboardChartConfig | undefined,
  scope: "platform" | "establishment",
): T[] {
  if (!config) return charts;
  return charts.map((chart) => ({
    ...chart,
    type: resolveChartType(chart.id, chart.type, config, scope),
  }));
}

export interface ChartCatalogEntry {
  id: string;
  title: string;
  defaultType: ChartType;
  scope: "platform" | "establishment";
}

export const PLATFORM_CHART_CATALOG: ChartCatalogEntry[] = [
  { id: "structure", title: "Structure du périmètre", defaultType: "bar", scope: "platform" },
  { id: "kpis", title: "Indicateurs clés", defaultType: "bar-horizontal", scope: "platform" },
  { id: "school-status", title: "Statut des établissements", defaultType: "donut", scope: "platform" },
  { id: "schools-country", title: "Établissements par territoire", defaultType: "bar-horizontal", scope: "platform" },
  {
    id: "subscription-payment",
    title: "Abonnements — statut de paiement",
    defaultType: "donut",
    scope: "platform",
  },
  { id: "subscription-plans", title: "Plans d'abonnement", defaultType: "bar", scope: "platform" },
  { id: "subscription-gauge", title: "Abonnements à jour", defaultType: "gauge", scope: "platform" },
];

export const ESTABLISHMENT_CHART_CATALOG: ChartCatalogEntry[] = [
  { id: "academic-bar", title: "Pilotage pédagogique", defaultType: "bar", scope: "establishment" },
  { id: "scolarite", title: "Scolarité / effectifs", defaultType: "bar", scope: "establishment" },
  { id: "notes-course", title: "Notes par matière", defaultType: "bar-horizontal", scope: "establishment" },
  { id: "presence-rate", title: "Taux de présence (jauge)", defaultType: "gauge", scope: "establishment" },
  { id: "presence-donut", title: "Répartition des présences", defaultType: "donut", scope: "establishment" },
  { id: "payments-status", title: "Paiements par statut", defaultType: "donut", scope: "establishment" },
  { id: "payments-amount", title: "Montants par statut", defaultType: "bar", scope: "establishment" },
  { id: "scolarite-finance", title: "Effectifs facturables", defaultType: "bar", scope: "establishment" },
  { id: "operations", title: "Activité administrative", defaultType: "bar", scope: "establishment" },
  { id: "scolarite-ops", title: "Scolarité (ops)", defaultType: "bar", scope: "establishment" },
  { id: "class-sizes", title: "Élèves par classe", defaultType: "bar-horizontal", scope: "establishment" },
  { id: "academic", title: "Pédagogie", defaultType: "bar", scope: "establishment" },
  { id: "operations-default", title: "Administration", defaultType: "bar", scope: "establishment" },
  { id: "payments", title: "Paiements", defaultType: "donut", scope: "establishment" },
  { id: "presence-gauge", title: "Taux de présence", defaultType: "gauge", scope: "establishment" },
  { id: "classes", title: "Effectifs par classe", defaultType: "bar-horizontal", scope: "establishment" },
];

export function formatChartTypeLabel(type: ChartType): string {
  const match = SUPERADMIN_CHART_TYPE_OPTIONS.find((option) => option.value === type);
  if (match) return `${match.emoji} ${match.label}`;
  if (type === "bar-horizontal") return "📊 Barres horizontales";
  if (type === "gauge") return "⏱ Jauge";
  return type;
}
