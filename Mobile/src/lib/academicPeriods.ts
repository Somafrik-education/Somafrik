export type PeriodLike = {
  name: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function buildCivilDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function parsePeriodDate(value?: string): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const dmy = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    return buildCivilDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  }

  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    return buildCivilDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDateWithinPeriod(now: Date, startDate: string, endDate: string): boolean {
  const start = parsePeriodDate(startDate);
  const end = parsePeriodDate(endDate);
  if (!start && !end) return false;
  const instant = now.getTime();
  const startMs = start ? startOfDay(start).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = end ? endOfDay(end).getTime() : Number.POSITIVE_INFINITY;
  return instant >= startMs && instant <= endMs;
}

export function findActivePeriodIndexByDate(periods: PeriodLike[], now: Date = new Date()): number {
  if (!periods.length) return 0;

  const exactIndex = periods.findIndex((period) =>
    isDateWithinPeriod(now, String(period.startDate ?? ""), String(period.endDate ?? "")),
  );
  if (exactIndex >= 0) return exactIndex;

  const nowMs = now.getTime();
  let bestPast = -1;
  let bestPastEnd = Number.NEGATIVE_INFINITY;

  periods.forEach((period, index) => {
    const start = parsePeriodDate(period.startDate);
    const end = parsePeriodDate(period.endDate);
    if (!start || startOfDay(start).getTime() > nowMs) return;
    const endMs = end ? endOfDay(end).getTime() : nowMs;
    if (endMs >= bestPastEnd) {
      bestPastEnd = endMs;
      bestPast = index;
    }
  });
  if (bestPast >= 0) return bestPast;

  let bestFuture = -1;
  let bestFutureStart = Number.POSITIVE_INFINITY;
  periods.forEach((period, index) => {
    const start = parsePeriodDate(period.startDate);
    if (!start) return;
    const startMs = startOfDay(start).getTime();
    if (startMs >= nowMs && startMs < bestFutureStart) {
      bestFutureStart = startMs;
      bestFuture = index;
    }
  });
  if (bestFuture >= 0) return bestFuture;

  return 0;
}

export function applySystemActivePeriod<T extends PeriodLike>(periods: T[], now: Date = new Date()): T[] {
  if (!periods.length) return periods;
  const activeIndex = findActivePeriodIndexByDate(periods, now);
  return periods.map((period, index) => ({ ...period, active: index === activeIndex }));
}

export function resolveActivePeriodName(periods: PeriodLike[], now: Date = new Date()): string | undefined {
  const resolved = applySystemActivePeriod(periods, now);
  return resolved.find((period) => period.active)?.name ?? resolved[0]?.name;
}
