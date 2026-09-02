"use strict";

const { applySystemActivePeriod, parsePeriodDate } = require("./academicPeriods");

const LEGACY_DEFAULT_ACADEMIC_PERIODS = Object.freeze([
  Object.freeze({
    name: "Trimestre 1",
    startDate: "01-09-2025",
    endDate: "31-12-2025",
  }),
  Object.freeze({
    name: "Trimestre 2",
    startDate: "01-01-2026",
    endDate: "31-03-2026",
  }),
  Object.freeze({
    name: "Trimestre 3",
    startDate: "01-04-2026",
    endDate: "30-06-2026",
  }),
]);

function pad(part) {
  return String(part).padStart(2, "0");
}

function toDisplayDate(date) {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function toComparableDate(value) {
  const parsed = parsePeriodDate(value);
  if (!parsed) return "";
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

function resolveAcademicYearBounds(academicYear) {
  const start = parsePeriodDate(academicYear?.startDate ?? academicYear?.start_date);
  const end = parsePeriodDate(academicYear?.endDate ?? academicYear?.end_date);
  if (!start || !end || start.getTime() > end.getTime()) return null;
  return { start, end };
}

function maxDate(a, b) {
  return a.getTime() >= b.getTime() ? a : b;
}

function minDate(a, b) {
  return a.getTime() <= b.getTime() ? a : b;
}

function buildRange(name, type, order, start, end) {
  if (start.getTime() > end.getTime()) return null;
  return {
    id: `${type.toLowerCase()}-${order}`,
    name,
    type,
    order,
    startDate: toDisplayDate(start),
    endDate: toDisplayDate(end),
    active: false,
  };
}

function splitAcademicYear(bounds, count, label) {
  const startMs = bounds.start.getTime();
  const endMs = bounds.end.getTime();
  const totalDays = Math.floor((endMs - startMs) / 86_400_000) + 1;
  const rows = [];
  let cursor = new Date(bounds.start);

  for (let index = 0; index < count; index += 1) {
    const remainingDays = totalDays - Math.floor((cursor.getTime() - startMs) / 86_400_000);
    const remainingParts = count - index;
    const partDays = Math.max(1, Math.floor(remainingDays / remainingParts));
    const end = index === count - 1
      ? new Date(bounds.end)
      : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + partDays - 1);
    const row = buildRange(`${label} ${index + 1}`, label, index + 1, cursor, minDate(end, bounds.end));
    if (row) rows.push(row);
    cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    if (cursor.getTime() > bounds.end.getTime()) break;
  }
  return rows;
}

function buildTraditionalAcademicPeriods(bounds, mode) {
  const startYear = bounds.start.getFullYear();
  const startsInSecondHalf = bounds.start.getMonth() >= 6;
  if (!startsInSecondHalf) {
    if (mode === "semestre") return splitAcademicYear(bounds, 2, "Semestre");
    if (mode === "periode") {
      const row = buildRange("Période 1", "Période", 1, bounds.start, bounds.end);
      return row ? [row] : [];
    }
    return splitAcademicYear(bounds, 3, "Trimestre");
  }

  const nextYear = startYear + 1;
  if (mode === "semestre") {
    return [
      buildRange(
        "Semestre 1",
        "Semestre",
        1,
        bounds.start,
        minDate(new Date(nextYear, 0, 31), bounds.end),
      ),
      buildRange(
        "Semestre 2",
        "Semestre",
        2,
        maxDate(new Date(nextYear, 1, 1), bounds.start),
        minDate(new Date(nextYear, 5, 30), bounds.end),
      ),
    ].filter(Boolean);
  }

  if (mode === "periode") {
    const row = buildRange("Période 1", "Période", 1, bounds.start, bounds.end);
    return row ? [row] : [];
  }

  return [
    buildRange(
      "Trimestre 1",
      "Trimestre",
      1,
      bounds.start,
      minDate(new Date(startYear, 11, 31), bounds.end),
    ),
    buildRange(
      "Trimestre 2",
      "Trimestre",
      2,
      maxDate(new Date(nextYear, 0, 1), bounds.start),
      minDate(new Date(nextYear, 2, 31), bounds.end),
    ),
    buildRange(
      "Trimestre 3",
      "Trimestre",
      3,
      maxDate(new Date(nextYear, 3, 1), bounds.start),
      minDate(new Date(nextYear, 5, 30), bounds.end),
    ),
  ].filter(Boolean);
}

function defaultAcademicPeriods(academicYear, mode = "trimestre") {
  const bounds = resolveAcademicYearBounds(academicYear);
  if (!bounds) return [];
  const normalizedMode = mode === "semestre" || mode === "periode" ? mode : "trimestre";
  return applySystemActivePeriod(buildTraditionalAcademicPeriods(bounds, normalizedMode));
}

function hasLegacyDefaultAcademicPeriodSignature(periods) {
  if (!Array.isArray(periods) || periods.length !== LEGACY_DEFAULT_ACADEMIC_PERIODS.length) return false;
  const byName = new Map(periods.map((period) => [String(period?.name ?? "").trim().toLowerCase(), period]));
  return LEGACY_DEFAULT_ACADEMIC_PERIODS.every((expected) => {
    const actual = byName.get(expected.name.toLowerCase());
    return Boolean(
      actual
      && toComparableDate(actual.startDate ?? actual.start_date) === toComparableDate(expected.startDate)
      && toComparableDate(actual.endDate ?? actual.end_date) === toComparableDate(expected.endDate),
    );
  });
}

function inferPeriodMode(periods) {
  const names = periods.map((period) => String(period.name ?? "").toLowerCase());
  if (names.some((name) => name.includes("semestre"))) return "semestre";
  if (names.some((name) => name.includes("trimestre"))) return "trimestre";
  return "periode";
}

function withSystemActivePeriods(config) {
  if (!config || !Array.isArray(config.periods)) return config;
  return {
    ...config,
    periods: applySystemActivePeriod(config.periods),
  };
}

module.exports = {
  LEGACY_DEFAULT_ACADEMIC_PERIODS,
  defaultAcademicPeriods,
  hasLegacyDefaultAcademicPeriodSignature,
  inferPeriodMode,
  resolveAcademicYearBounds,
  withSystemActivePeriods,
};
