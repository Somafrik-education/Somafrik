"use strict";

/**
 * F3 — clés de période stables. Pas de prorata. Pas d'identité « Septembre » seule.
 */

const { feeTypeToken } = require("./financeFeeTypes");

function asTrimmed(value) {
  return String(value ?? "").trim();
}

const MONTH_INDEX = Object.freeze({
  janvier: 1,
  jan: 1,
  january: 1,
  fevrier: 2,
  feb: 2,
  february: 2,
  mars: 3,
  mar: 3,
  march: 3,
  avril: 4,
  apr: 4,
  april: 4,
  mai: 5,
  may: 5,
  juin: 6,
  jun: 6,
  june: 6,
  juillet: 7,
  jul: 7,
  july: 7,
  aout: 8,
  aug: 8,
  august: 8,
  septembre: 9,
  sep: 9,
  sept: 9,
  september: 9,
  octobre: 10,
  oct: 10,
  october: 10,
  novembre: 11,
  nov: 11,
  november: 11,
  decembre: 12,
  dec: 12,
  december: 12,
});

const ONCE_PERIOD_KEY = "ONCE";

function academicYearStartYear(academicYear) {
  const match = String(academicYear ?? "").match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

function monthIndex(value) {
  const token = feeTypeToken(value);
  if (!token) return null;
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token);
    return n >= 1 && n <= 12 ? n : null;
  }
  if (/^\d{4} \d{2}$/.test(token)) {
    return Number(token.slice(-2));
  }
  return MONTH_INDEX[token] || MONTH_INDEX[token.split(" ")[0]] || null;
}

function periodKeyForMonth(academicYear, monthValue) {
  const startYear = academicYearStartYear(academicYear);
  const month = monthIndex(monthValue);
  if (!startYear || !month) return null;
  const calendarYear = month >= 9 ? startYear : startYear + 1;
  return `${calendarYear}-${String(month).padStart(2, "0")}`;
}

function periodYearMonth(periodKey) {
  const match = String(periodKey ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), key: `${match[1]}-${match[2]}` };
}

function expandFeeItemPeriods(item, academicYear) {
  const months = Array.isArray(item?.monthlyMonths) ? item.monthlyMonths.filter((row) => asTrimmed(row)) : [];
  if (months.length) {
    return months.map((month) => {
      const periodKey = periodKeyForMonth(academicYear, month);
      return {
        periodLabel: asTrimmed(month),
        periodKey: periodKey || `M:${feeTypeToken(month)}`,
      };
    });
  }
  const label = asTrimmed(item?.periodLabel);
  if (label) {
    const fromMonth = periodKeyForMonth(academicYear, label);
    if (fromMonth) {
      return [{ periodLabel: label, periodKey: fromMonth }];
    }
    return [{ periodLabel: label, periodKey: `ONCE:${feeTypeToken(label)}` }];
  }
  return [{ periodLabel: "", periodKey: ONCE_PERIOD_KEY }];
}

function isPeriodAfterEffectiveMonth(periodKey, effectiveDate) {
  const period = periodYearMonth(periodKey);
  const iso = asTrimmed(effectiveDate);
  if (!period || !iso) return false;
  const effectiveMonth = iso.slice(0, 7);
  return period.key > effectiveMonth;
}

module.exports = {
  ONCE_PERIOD_KEY,
  academicYearStartYear,
  monthIndex,
  periodKeyForMonth,
  periodYearMonth,
  expandFeeItemPeriods,
  isPeriodAfterEffectiveMonth,
};
