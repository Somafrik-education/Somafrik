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
  mapExclusionViolation,
  mapWeeklyScheduleDto,
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

test("409 collisions classe / enseignant / salle restent distinctes", () => {
  assert.equal(
    mapExclusionViolation({ constraint: "no_class_overlap" }).message,
    "Conflit d'emploi du temps : classe déjà occupée.",
  );
  assert.equal(
    mapExclusionViolation({ constraint: "no_teacher_overlap" }).message,
    "Conflit d'emploi du temps : enseignant déjà occupé.",
  );
  assert.equal(
    mapExclusionViolation({ constraint: "no_room_overlap" }).message,
    "Conflit d'emploi du temps : salle déjà occupée.",
  );
  assert.equal(mapExclusionViolation({ constraint: "no_class_overlap" }).statusCode, 409);
  assert.equal(mapExclusionViolation({ constraint: "no_class_overlap" }).code, PEDAGOGY_ERROR.COURSE_SCHEDULE_CONFLICT);
});

test("DTO weekly conserve dayOfWeek / heures / IDs canoniques", () => {
  const dto = mapWeeklyScheduleDto({
    id: "slot-1",
    school_course_id: "course-1",
    academic_year_id: "year-1",
    class_id: "class-1",
    teacher_id: "teacher-1",
    day_of_week: 1,
    start_time: "08:00:00",
    end_time: "09:00:00",
    status: "active",
    room_id: "room-4",
    room_name: "Salle 4",
    class_code: "3A",
    class_name: "3e A",
    subject_name: "Mathématiques",
    teacher_name: "M. Okito",
    teacher_code: "ENS-0001",
  });
  assert.equal(dto.dayOfWeek, 1);
  assert.equal(dto.startTime, "08:00");
  assert.equal(dto.endTime, "09:00");
  assert.equal(dto.schoolCourseId, "course-1");
  assert.equal(dto.roomId, "room-4");
  assert.equal(dto.classCode, "3A");
});
