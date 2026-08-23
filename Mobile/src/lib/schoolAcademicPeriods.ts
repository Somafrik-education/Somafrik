export type PeriodMode = "trimestre" | "semestre" | "periode";

export type AcademicPeriodRow = {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  active: boolean;
  order: number;
};

export type AcademicYearBoundsInput = {
  name?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean;
};

export type ResolvedAcademicYearBounds = {
  start: Date;
  end: Date;
  startYear: number;
  endYear: number;
};

export function periodTypeLabel(mode: PeriodMode): string {
  if (mode === "semestre") return "Semestre";
  if (mode === "periode") return "Période";
  return "Trimestre";
}

export function coercePeriodMode(value: unknown): PeriodMode {
  const mode = String(value ?? "trimestre").toLowerCase();
  if (mode === "semestre") return "semestre";
  if (mode === "periode" || mode === "custom") return "periode";
  return "trimestre";
}

export function selectCurrentAcademicYear<T extends AcademicYearBoundsInput>(
  years: T[] | null | undefined,
): T | null {
  if (!years?.length) return null;
  return years.find((year) => year.isCurrent) ?? years[0] ?? null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatPeriodDate(date: Date): string {
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function calendarDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

function parseYearName(name?: string | null): { startYear: number; endYear: number } | null {
  const match = String(name ?? "")
    .trim()
    .match(/^(20\d{2})\s*[-–/]\s*(20\d{2})$/);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || endYear < startYear) return null;
  return { startYear, endYear };
}

function inferStartYearFromClock(now: Date): number {
  // Août–décembre : l’année civile courante ouvre (ou va ouvrir) l’année scolaire.
  // Janvier–juillet : on est dans la seconde moitié (Y-1 → Y).
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

export function resolveAcademicYearBounds(
  year?: AcademicYearBoundsInput | null,
  now: Date = new Date(),
): ResolvedAcademicYearBounds {
  const named = parseYearName(year?.name);
  const startFromField = parsePeriodDate(year?.startDate ?? undefined);
  const endFromField = parsePeriodDate(year?.endDate ?? undefined);

  if (startFromField && endFromField && endFromField.getTime() >= startFromField.getTime()) {
    return {
      start: startOfDay(startFromField),
      end: endOfDay(endFromField),
      startYear: named?.startYear ?? startFromField.getFullYear(),
      endYear: named?.endYear ?? Math.max(endFromField.getFullYear(), (named?.startYear ?? startFromField.getFullYear()) + 1),
    };
  }

  if (named) {
    return {
      start: startFromField ? startOfDay(startFromField) : calendarDate(named.startYear, 8, 1),
      end: endFromField ? endOfDay(endFromField) : endOfDay(calendarDate(named.endYear, 7, 31)),
      startYear: named.startYear,
      endYear: named.endYear,
    };
  }

  const startYear = inferStartYearFromClock(now);
  return {
    start: calendarDate(startYear, 8, 1),
    end: endOfDay(calendarDate(startYear + 1, 7, 31)),
    startYear,
    endYear: startYear + 1,
  };
}

function clampDate(date: Date, min: Date, max: Date): Date {
  const time = date.getTime();
  if (time < min.getTime()) return startOfDay(min);
  if (time > max.getTime()) return startOfDay(max);
  return startOfDay(date);
}

function periodRange(
  start: Date,
  end: Date,
  bounds: ResolvedAcademicYearBounds,
): { startDate: string; endDate: string } {
  const clampedStart = clampDate(start, bounds.start, bounds.end);
  let clampedEnd = clampDate(end, bounds.start, bounds.end);
  if (clampedEnd.getTime() < clampedStart.getTime()) {
    clampedEnd = clampedStart;
  }
  return {
    startDate: formatPeriodDate(clampedStart),
    endDate: formatPeriodDate(clampedEnd),
  };
}

function buildDefaultRows(mode: PeriodMode, year?: AcademicYearBoundsInput | null, now: Date = new Date()): AcademicPeriodRow[] {
  const bounds = resolveAcademicYearBounds(year, now);
  const y1 = bounds.startYear;
  const y2 = bounds.endYear > y1 ? bounds.endYear : y1 + 1;

  if (mode === "semestre") {
    return [
      {
        name: "Semestre 1",
        type: "Semestre",
        ...periodRange(calendarDate(y1, 8, 1), calendarDate(y2, 0, 31), bounds),
        active: false,
        order: 1,
      },
      {
        name: "Semestre 2",
        type: "Semestre",
        ...periodRange(calendarDate(y2, 1, 1), calendarDate(y2, 5, 30), bounds),
        active: false,
        order: 2,
      },
    ];
  }

  if (mode === "periode") {
    return [
      {
        name: "Période 1",
        type: "Période",
        ...periodRange(calendarDate(y1, 8, 1), calendarDate(y1, 9, 31), bounds),
        active: false,
        order: 1,
      },
    ];
  }

  return [
    {
      name: "Trimestre 1",
      type: "Trimestre",
      ...periodRange(calendarDate(y1, 8, 1), calendarDate(y1, 11, 31), bounds),
      active: false,
      order: 1,
    },
    {
      name: "Trimestre 2",
      type: "Trimestre",
      ...periodRange(calendarDate(y2, 0, 1), calendarDate(y2, 2, 31), bounds),
      active: false,
      order: 2,
    },
    {
      name: "Trimestre 3",
      type: "Trimestre",
      ...periodRange(calendarDate(y2, 3, 1), calendarDate(y2, 5, 30), bounds),
      active: false,
      order: 3,
    },
  ];
}

export function parsePeriodDate(value?: string): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isDateWithinPeriod(now: Date, startDate: string, endDate: string): boolean {
  const start = parsePeriodDate(startDate);
  const end = parsePeriodDate(endDate);
  if (!start && !end) return false;
  const instant = now.getTime();
  const startMs = start ? startOfDay(start).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = end ? endOfDay(end).getTime() : Number.POSITIVE_INFINITY;
  return instant >= startMs && instant <= endMs;
}

export function findActivePeriodIndexByDate(rows: AcademicPeriodRow[], now: Date = new Date()): number {
  if (!rows.length) return -1;
  return rows.findIndex((row) => isDateWithinPeriod(now, row.startDate, row.endDate));
}

export function ensureSingleActivePeriod(rows: AcademicPeriodRow[], activeIndex: number): AcademicPeriodRow[] {
  if (activeIndex < 0) {
    return rows.map((row) => ({ ...row, active: false }));
  }
  return rows.map((row, index) => ({ ...row, active: index === activeIndex }));
}

export function applySystemActivePeriod(rows: AcademicPeriodRow[], now: Date = new Date()): AcademicPeriodRow[] {
  if (!rows.length) return rows;
  return ensureSingleActivePeriod(rows, findActivePeriodIndexByDate(rows, now));
}

export function defaultPeriodsForMode(
  mode: PeriodMode,
  now: Date = new Date(),
  year?: AcademicYearBoundsInput | null,
): AcademicPeriodRow[] {
  return applySystemActivePeriod(buildDefaultRows(mode, year, now), now);
}

export function normalizeStoredPeriods(
  raw: unknown,
  mode: PeriodMode,
  now: Date = new Date(),
  year?: AcademicYearBoundsInput | null,
): AcademicPeriodRow[] {
  if (!Array.isArray(raw) || !raw.length) {
    return defaultPeriodsForMode(mode, now, year);
  }
  const typeLabel = periodTypeLabel(mode);
  const rows = raw.map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      name: String(row.name ?? `${typeLabel} ${index + 1}`),
      type: String(row.type ?? typeLabel),
      startDate: String(row.startDate ?? ""),
      endDate: String(row.endDate ?? ""),
      active: false,
      order: Number(row.order ?? index + 1),
    };
  });
  return applySystemActivePeriod(rows, now);
}

export function serializePeriods(
  rows: AcademicPeriodRow[],
  mode: PeriodMode,
  now: Date = new Date(),
  year?: AcademicYearBoundsInput | null,
) {
  const source = rows.length ? rows : defaultPeriodsForMode(mode, now, year);
  return applySystemActivePeriod(source, now)
    .map((row) => ({
      ...row,
      name: row.name.trim(),
      startDate: row.startDate.trim(),
      endDate: row.endDate.trim(),
    }))
    .filter((row) => row.name)
    .map((row, index) => ({
      id: `${mode}-${index + 1}`,
      name: row.name,
      type: row.type || periodTypeLabel(mode),
      startDate: row.startDate,
      endDate: row.endDate,
      active: row.active,
      order: index + 1,
    }));
}
