"use strict";

/**
 * Projection calendrier à partir d'une définition hebdomadaire PostgreSQL.
 * La définition (day_of_week + TIME) reste l'autorité ; les dates sont dérivées.
 * Ne dépend pas du fuseau du processus Node au-delà de timeZone fourni.
 */

const { isoWeekdayFromUtcDate } = require("./planningWeekly");

const DEFAULT_SCHOOL_TIMEZONE = "Africa/Kinshasa";

function resolveSchoolTimeZone(raw) {
  const tz = String(raw ?? "").trim();
  if (!tz) return DEFAULT_SCHOOL_TIMEZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_SCHOOL_TIMEZONE;
  }
}

function parseCivilDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return utc;
}

function formatCivilDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Convertit un mur local (date civile + HH:MM) dans `timeZone` vers ISO-8601.
 */
function zonedWallTimeToIso(civilDate, timeHm, timeZone) {
  const date = typeof civilDate === "string" ? parseCivilDate(civilDate) : civilDate;
  if (!date) return null;
  const [hourRaw, minuteRaw] = String(timeHm ?? "00:00").split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const wanted = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = wanted;
  for (let i = 0; i < 8; i += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utc));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    const diff = Date.UTC(year, month - 1, day, hour, minute) - asUtc;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc).toISOString();
}

function listMatchingCivilDates(fromValue, toValue, dayOfWeek) {
  const from = parseCivilDate(fromValue);
  const to = parseCivilDate(toValue);
  if (!from || !to || to < from) return [];
  const dates = [];
  let cursor = from;
  while (cursor <= to) {
    if (isoWeekdayFromUtcDate(cursor) === Number(dayOfWeek)) {
      dates.push(formatCivilDate(cursor));
    }
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}

function expandWeeklyOccurrences(slot, { from, to, timeZone } = {}) {
  const tz = resolveSchoolTimeZone(timeZone);
  const dates = listMatchingCivilDates(from, to, slot.dayOfWeek ?? slot.day_of_week);
  const startTime = slot.startTime || slot.start_time;
  const endTime = slot.endTime || slot.end_time;
  return dates.map((occurrenceDate) => ({
    id: `${slot.id}__${occurrenceDate}`,
    scheduleId: slot.id,
    occurrenceDate,
    dayOfWeek: Number(slot.dayOfWeek ?? slot.day_of_week),
    startTime: String(startTime).slice(0, 5),
    endTime: String(endTime).slice(0, 5),
    start: zonedWallTimeToIso(occurrenceDate, startTime, tz),
    end: zonedWallTimeToIso(occurrenceDate, endTime, tz),
    timeZone: tz,
  }));
}

module.exports = {
  DEFAULT_SCHOOL_TIMEZONE,
  resolveSchoolTimeZone,
  parseCivilDate,
  formatCivilDate,
  zonedWallTimeToIso,
  listMatchingCivilDates,
  expandWeeklyOccurrences,
};
