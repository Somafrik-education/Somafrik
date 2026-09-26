import type { DomainKey } from "./domainLoaders";

/** Same-tab signal after a write that must refresh the establishment dashboard. */
export const DASHBOARD_SYNC_EVENT = "somafrik:dashboard-activities-changed";

/** Agreed delay for another session. Not a server push channel. */
export const DASHBOARD_SYNC_INTERVAL_MS = 10_000;

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
