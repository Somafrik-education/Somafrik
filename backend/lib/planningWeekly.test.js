"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");
const {
  parseDayOfWeek,
  parseLocalTime,
  assertTimeOrder,
  formatTimeHm,
  isoWeekdayFromUtcDate,
} = require("./planningWeekly");

test("dayOfWeek 1=lundi … 7=dimanche, 0 refusé", () => {
  assert.equal(parseDayOfWeek(1), 1);
  assert.equal(parseDayOfWeek("7"), 7);
  assert.throws(() => parseDayOfWeek(0), (error) => error.code === PEDAGOGY_ERROR.INVALID_DAY_OF_WEEK);
  assert.throws(() => parseDayOfWeek(8), (error) => error.code === PEDAGOGY_ERROR.INVALID_DAY_OF_WEEK);
  assert.throws(() => parseDayOfWeek("lundi"), (error) => error.code === PEDAGOGY_ERROR.INVALID_DAY_OF_WEEK);
});

test("heures locales HH:MM, end > start, pas de minuit", () => {
  assert.equal(parseLocalTime("08:00", "startTime"), "08:00:00");
  assert.equal(parseLocalTime("09:00:00", "endTime"), "09:00:00");
  assert.doesNotThrow(() => assertTimeOrder("08:00:00", "09:00:00"));
  assert.throws(() => assertTimeOrder("09:00:00", "09:00:00"), (error) => error.code === PEDAGOGY_ERROR.INVALID_TIME_RANGE);
  assert.throws(() => assertTimeOrder("09:00:00", "08:00:00"), (error) => error.code === PEDAGOGY_ERROR.INVALID_TIME_RANGE);
  assert.throws(() => parseLocalTime("24:00", "startTime"), (error) => error.code === PEDAGOGY_ERROR.INVALID_TIME_RANGE);
});

test("formatTimeHm et weekday ISO indépendant de Date.getDay", () => {
  assert.equal(formatTimeHm("08:00:00"), "08:00");
  const monday = new Date(Date.UTC(2026, 8, 7));
  assert.equal(isoWeekdayFromUtcDate(monday), 1);
  const sunday = new Date(Date.UTC(2026, 8, 13));
  assert.equal(isoWeekdayFromUtcDate(sunday), 7);
});
