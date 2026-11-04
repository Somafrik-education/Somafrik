import type { DomainKey } from "./domainLoaders";

/** Same-tab signal after a write that must refresh the establishment dashboard. */
export const DASHBOARD_SYNC_EVENT = "somafrik:dashboard-activities-changed";

/** Light KPI refresh while the dashboard tab is visible. */
export const DASHBOARD_KPI_INTERVAL_MS = 60_000;

/** Recent-activity refresh while the dashboard tab is visible. */
export const DASHBOARD_ACTIVITY_INTERVAL_MS = 60_000;

/** Manual refresh from the top bar. Does not reload the six full lists. */
export const DASHBOARD_KPI_REFRESH_EVENT = "somafrik:dashboard-kpis-refresh";

export function dashboardDataIsStale(lastSuccessAt: number | null, now: number, intervalMs: number) {
  if (lastSuccessAt == null) return true;
  return now - lastSuccessAt >= intervalMs;
}

export const DASHBOARD_METRIC_DOMAINS = [
  "students",
  "teachers",
  "classes",
  "presences",
  "payments",
  "studentFees",
] as const satisfies readonly DomainKey[];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Writes that change a KPI, a chart, or the activity feed. */
export function mutationRefreshesDashboard(method: string | undefined, path: string): boolean {
  const verb = String(method ?? "").toUpperCase();
  if (!WRITE_METHODS.has(verb)) return false;
  const bare = path.split("?")[0] ?? "";
  return /^\/(?:attendance|presences|course-schedules|payments|classes)(?:\/|$)/.test(bare);
}
