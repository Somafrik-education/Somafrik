export type PeriodMode = "trimestre" | "semestre" | "periode";

export interface AcademicPeriodRow {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  active: boolean;
  order: number;
}

export function periodTypeLabel(mode: PeriodMode): string {
  if (mode === "semestre") return "Semestre";
  if (mode === "periode") return "Période";
  return "Trimestre";
}

function schoolYearStartYear(now: Date): number {
  // Somafrik : l'année scolaire canonique démarre au second semestre civil
  // (ex. 2026-2027). De janvier à juin, on reste donc sur l'année démarrée
  // l'année civile précédente.
  return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
}

function periodDate(day: number, month: number, year: number): string {
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}

function buildDefaultRows(mode: PeriodMode, now: Date): AcademicPeriodRow[] {
  const startYear = schoolYearStartYear(now);
  const endYear = startYear + 1;
  if (mode === "semestre") {
    return [
      {
        name: "Semestre 1",
        type: "Semestre",
        startDate: periodDate(1, 9, startYear),
        endDate: periodDate(31, 1, endYear),
        active: false,
        order: 1,
      },
      {
        name: "Semestre 2",
        type: "Semestre",
        startDate: periodDate(1, 2, endYear),
        endDate: periodDate(30, 6, endYear),
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
        startDate: periodDate(1, 9, startYear),
        endDate: periodDate(31, 10, startYear),
        active: false,
        order: 1,
      },
    ];
  }
  return [
    {
      name: "Trimestre 1",
      type: "Trimestre",
      startDate: periodDate(1, 9, startYear),
      endDate: periodDate(31, 12, startYear),
      active: false,
      order: 1,
    },
    {
      name: "Trimestre 2",
      type: "Trimestre",
      startDate: periodDate(1, 1, endYear),
      endDate: periodDate(31, 3, endYear),
      active: false,
      order: 2,
    },
    {
      name: "Trimestre 3",
      type: "Trimestre",
      startDate: periodDate(1, 4, endYear),
      endDate: periodDate(30, 6, endYear),
      active: false,
      order: 3,
    },
  ];
}

export function defaultPeriodsForMode(mode: PeriodMode, now: Date = new Date()): AcademicPeriodRow[] {
  return applySystemActivePeriod(buildDefaultRows(mode, now), now);
}

export function coercePeriodMode(value: unknown): PeriodMode {
  const mode = String(value ?? "trimestre").toLowerCase();
  if (mode === "semestre") return "semestre";
  if (mode === "periode" || mode === "custom") return "periode";
  return "trimestre";
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

  // Format compact hérité JJMMAAAA (ex. "01012000" → 01/01/2000).
  const compact = raw.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (compact) {
    const day = Number(compact[1]);
    const month = Number(compact[2]);
    const year = Number(compact[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** JJ-MM-AAAA → YYYY-MM-DD (champ date HTML). */
export function periodDateToInput(value?: string): string {
  const date = parsePeriodDate(value);
  if (!date) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYY-MM-DD → JJ-MM-AAAA (stockage backoffice). */
export function inputToPeriodDate(value?: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return raw;
  const pad = (part: string) => part.padStart(2, "0");
  return `${pad(match[3])}-${pad(match[2])}-${match[1]}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
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

export function findActivePeriodIndexByDate(
  rows: AcademicPeriodRow[],
  now: Date = new Date(),
): number {
  if (!rows.length) return 0;

  const exactIndex = rows.findIndex((row) => isDateWithinPeriod(now, row.startDate, row.endDate));
  if (exactIndex >= 0) return exactIndex;

  const nowMs = now.getTime();
  let bestPast = -1;
  let bestPastEnd = Number.NEGATIVE_INFINITY;

  rows.forEach((row, index) => {
    const start = parsePeriodDate(row.startDate);
    const end = parsePeriodDate(row.endDate);
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
  rows.forEach((row, index) => {
    const start = parsePeriodDate(row.startDate);
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

export function ensureSingleActivePeriod(rows: AcademicPeriodRow[], activeIndex: number): AcademicPeriodRow[] {
  return rows.map((row, index) => ({ ...row, active: index === activeIndex }));
}

export function applySystemActivePeriod(
  rows: AcademicPeriodRow[],
  now: Date = new Date(),
): AcademicPeriodRow[] {
  if (!rows.length) return rows;
  return ensureSingleActivePeriod(rows, findActivePeriodIndexByDate(rows, now));
}

export function normalizeStoredPeriods(raw: unknown, mode: PeriodMode, now: Date = new Date()): AcademicPeriodRow[] {
  if (!Array.isArray(raw) || !raw.length) {
    return defaultPeriodsForMode(mode, now);
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

export function serializePeriods(rows: AcademicPeriodRow[], mode: PeriodMode, now: Date = new Date()) {
  return applySystemActivePeriod(rows, now)
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

export function resolveActivePeriodName(
  periods: Array<{ name: string; startDate?: string; endDate?: string; active?: boolean }>,
  now: Date = new Date(),
): string | undefined {
  const rows = periods.map((period, index) => ({
    name: period.name,
    type: "",
    startDate: String(period.startDate ?? ""),
    endDate: String(period.endDate ?? ""),
    active: false,
    order: index + 1,
  }));
  return applySystemActivePeriod(rows, now).find((period) => period.active)?.name ?? rows[0]?.name;
}
