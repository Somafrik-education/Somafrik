import assert from "node:assert/strict";
import { addCivilDays, canonicalWeekday, civilDate, countByWeekday, mondayOf, planningVisibleDays, shiftPlanningAnchor } from "./planningNativeCalendar";

const anchor = new Date(2026, 10, 6); // vendredi, heure locale
assert.equal(civilDate(anchor), "2026-11-06");
assert.equal(canonicalWeekday(anchor), 5);
assert.equal(civilDate(mondayOf(anchor)), "2026-11-02");
assert.equal(planningVisibleDays("day", anchor).length, 1);
const week = planningVisibleDays("week", anchor);
assert.equal(week.length, 7);
assert.equal(civilDate(week[0]), "2026-11-02");
assert.equal(civilDate(week[6]), "2026-11-08");
const month = planningVisibleDays("month", anchor);
assert.equal(month.length, 42);
assert.equal(civilDate(month[0]), "2026-10-26");
assert.equal(civilDate(month[41]), "2026-12-06");
assert.equal(civilDate(shiftPlanningAnchor("day", anchor, 1)), "2026-11-07");
assert.equal(civilDate(shiftPlanningAnchor("week", anchor, -1)), "2026-10-30");
assert.equal(civilDate(shiftPlanningAnchor("month", new Date(2026, 0, 31), 1)), "2026-02-01");
assert.equal(civilDate(addCivilDays(new Date(2026, 2, 28), 2)), "2026-03-30");
assert.equal(countByWeekday([{ dayOfWeek: 5 }, { dayOfWeek: 5 }, { dayOfWeek: 1 }], anchor), 2);
console.log("OK planningNativeCalendar.test (civil dates, week, month, year rollover, count)");
