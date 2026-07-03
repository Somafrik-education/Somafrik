export type ChartOrderScope = "platform" | "establishment";

const STORAGE_PREFIX = "somafrik:chart-order:";

function storageKey(scope: ChartOrderScope, userKey?: string) {
  const user = String(userKey ?? "anonymous").trim() || "anonymous";
  return `${STORAGE_PREFIX}${scope}:${user}`;
}

export function readChartOrder(scope: ChartOrderScope, userKey?: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(scope, userKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => String(id)).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveChartOrder(scope: ChartOrderScope, userKey: string | undefined, order: string[]) {
  try {
    const key = storageKey(scope, userKey);
    if (!order.length) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

export function mergeChartOrder(savedIds: string[], currentIds: string[]): string[] {
  const currentSet = new Set(currentIds);
  const kept = savedIds.filter((id) => currentSet.has(id));
  const keptSet = new Set(kept);
  const extras = currentIds.filter((id) => !keptSet.has(id));
  return [...kept, ...extras];
}

export function applyChartOrder<T extends { id: string }>(
  charts: T[],
  scope: ChartOrderScope,
  userKey?: string,
): T[] {
  const saved = readChartOrder(scope, userKey);
  if (!saved.length) return charts;

  const byId = new Map(charts.map((chart) => [chart.id, chart]));
  return mergeChartOrder(saved, charts.map((chart) => chart.id))
    .map((id) => byId.get(id))
    .filter((chart): chart is T => Boolean(chart));
}

export function resolveChartOrderUserKey(user: {
  id?: string;
  publicId?: string;
  identifier?: string;
  email?: string;
} | null | undefined): string {
  return String(user?.id ?? user?.publicId ?? user?.identifier ?? user?.email ?? "anonymous").trim() || "anonymous";
}
