import { parsePeriodDate } from "./academicPeriods";

export type ChartPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "annual";

export const CHART_PERIOD_OPTIONS: Array<{ value: ChartPeriod; label: string }> = [
  { value: "daily", label: "Quotidien" },
  { value: "weekly", label: "Hebdomadaire" },
  { value: "monthly", label: "Mensuel" },
  { value: "quarterly", label: "Trimestriel" },
  { value: "annual", label: "Annuel" },
];

export const DEFAULT_CHART_PERIOD: ChartPeriod = "monthly";

const STORAGE_DEFAULT_KEY = "somafrik:chart-period:default";
const STORAGE_CHART_PREFIX = "somafrik:chart-period:";

const VALID_PERIODS = new Set<ChartPeriod>(CHART_PERIOD_OPTIONS.map((option) => option.value));

type Row = Record<string, unknown>;

const RECORD_DATE_FIELDS = [
  "date",
  "paymentDate",
  "createdAt",
  "lastPaymentDate",
  "startDate",
  "endDate",
  "enteredAt",
  "publishedAt",
  "generatedAt",
  "lastLoginAt",
  "validationRequestedAt",
  "sentAt",
  "examDate",
] as const;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function normalizeChartPeriod(value: unknown): ChartPeriod {
  const key = String(value ?? "").trim() as ChartPeriod;
  return VALID_PERIODS.has(key) ? key : DEFAULT_CHART_PERIOD;
}

export function readDefaultChartPeriod(): ChartPeriod {
  try {
    return normalizeChartPeriod(localStorage.getItem(STORAGE_DEFAULT_KEY));
  } catch {
    return DEFAULT_CHART_PERIOD;
  }
}

export function readChartPeriod(chartId: string): ChartPeriod {
  try {
    const stored = localStorage.getItem(`${STORAGE_CHART_PREFIX}${chartId}`);
    if (stored) return normalizeChartPeriod(stored);
  } catch {
    /* ignore */
  }
  return readDefaultChartPeriod();
}

export function saveChartPeriod(chartId: string, period: ChartPeriod) {
  const normalized = normalizeChartPeriod(period);
  try {
    localStorage.setItem(`${STORAGE_CHART_PREFIX}${chartId}`, normalized);
  } catch {
    /* ignore */
  }
}

export function getPeriodBounds(period: ChartPeriod, now = new Date()): { start: Date; end: Date } {
  const end = endOfDay(now);

  switch (period) {
    case "daily":
      return { start: startOfDay(now), end };
    case "weekly": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { start: startOfDay(start), end };
    }
    case "monthly":
      return { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), end };
    case "quarterly": {
      const quarter = Math.floor(now.getMonth() / 3);
      return { start: startOfDay(new Date(now.getFullYear(), quarter * 3, 1)), end };
    }
    case "annual":
      return { start: startOfDay(new Date(now.getFullYear(), 0, 1)), end };
    default:
      return { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), end };
  }
}

export function extractRowDate(row: Row, extraFields: string[] = []): Date | null {
  for (const field of [...extraFields, ...RECORD_DATE_FIELDS]) {
    const parsed = parsePeriodDate(String(row[field] ?? ""));
    if (parsed) return parsed;
  }
  return null;
}

export function isRowWithinPeriod(row: Row, period: ChartPeriod, now = new Date(), extraFields: string[] = []) {
  const date = extractRowDate(row, extraFields);
  if (!date) return false;
  const { start, end } = getPeriodBounds(period, now);
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

export function filterRowsByPeriod<T extends Row>(
  rows: T[],
  period: ChartPeriod,
  now = new Date(),
  extraFields: string[] = [],
): T[] {
  return rows.filter((row) => isRowWithinPeriod(row, period, now, extraFields));
}

export function formatChartPeriodLabel(period: ChartPeriod): string {
  return CHART_PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? "Mensuel";
}

export function formatPeriodRangeDescription(period: ChartPeriod, now = new Date()): string {
  const { start, end } = getPeriodBounds(period, now);
  const formatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${formatChartPeriodLabel(period)} · ${formatter.format(start)} – ${formatter.format(end)}`;
}
