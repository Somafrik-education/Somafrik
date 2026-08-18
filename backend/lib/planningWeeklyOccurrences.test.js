"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  listMatchingCivilDates,
  expandWeeklyOccurrences,
  zonedWallTimeToIso,
  resolveSchoolTimeZone,
} = require("./planningWeeklyOccurrences");

test("lundi 2026-09-01 → 2026-09-30 = uniquement des lundis, y compris changement de mois", () => {
  const dates = listMatchingCivilDates("2026-09-01", "2026-09-30", 1);
  assert.deepEqual(dates, ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  assert.ok(dates.every((value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 1));
});

test("plage à cheval sur une année civile", () => {
  const dates = listMatchingCivilDates("2026-12-28", "2027-01-04", 1);
  assert.deepEqual(dates, ["2026-12-28", "2027-01-04"]);
});

test("occurrences serveur : définition PG, pas le TZ du process", () => {
  const slot = {
    id: "slot-1",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:00",
  };
  const items = expandWeeklyOccurrences(slot, {
    from: "2026-09-01",
    to: "2026-09-30",
    timeZone: "Africa/Kinshasa",
  });
  assert.equal(items.length, 4);
  assert.ok(items.every((row) => row.occurrenceDate.startsWith("2026-09-")));
  assert.ok(items.every((row) => row.timeZone === "Africa/Kinshasa"));
  assert.equal(items[0].startTime, "08:00");
});

test("timezone établissement : 08:00 Africa/Kinshasa n'est pas 08:00 UTC", () => {
  const iso = zonedWallTimeToIso("2026-09-07", "08:00", "Africa/Kinshasa");
  assert.ok(iso);
  assert.notEqual(iso, "2026-09-07T08:00:00.000Z");
  assert.equal(new Date(iso).toISOString(), iso);
});

test("DST Europe/Paris : les lundis restent des lundis civils", () => {
  const dates = listMatchingCivilDates("2026-03-23", "2026-04-06", 1);
  assert.deepEqual(dates, ["2026-03-23", "2026-03-30", "2026-04-06"]);
  const items = expandWeeklyOccurrences(
    { id: "dst", dayOfWeek: 1, startTime: "08:00", endTime: "09:00" },
    { from: "2026-03-23", to: "2026-04-06", timeZone: "Europe/Paris" },
  );
  assert.equal(items.length, 3);
  assert.equal(resolveSchoolTimeZone("Europe/Paris"), "Europe/Paris");
  assert.equal(resolveSchoolTimeZone("not-a-zone"), "Africa/Kinshasa");
});
