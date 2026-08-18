"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classifyLegacyScheduleRow, classifyLegacyScheduleRows } = require("./planningWeeklyMigrationPreflight");

const catalogs = {
  timeZone: "Africa/Kinshasa",
  classById: {
    "class-1": { id: "class-1", academic_year_id: "year-1" },
  },
  yearById: {
    "year-1": { id: "year-1", school_id: "school-1" },
  },
  subjects: [{ id: "sub-math", school_id: "school-1", name: "Mathématiques" }],
  schoolCourses: [
    {
      id: "course-1",
      school_id: "school-1",
      class_id: "class-1",
      subject_id: "sub-math",
      teacher_id: "teacher-1",
      status: "active",
    },
  ],
};

test("EXAM n'est jamais migrable vers weekly", () => {
  const result = classifyLegacyScheduleRow({ id: "e1", slot_kind: "exam", class_id: "class-1" }, catalogs);
  assert.equal(result.classification, "EXAM");
});

test("ORPHAN si class_id ou matière absents", () => {
  assert.equal(classifyLegacyScheduleRow({ id: "o1", slot_kind: "course" }, catalogs).classification, "ORPHAN");
  assert.equal(
    classifyLegacyScheduleRow(
      { id: "o2", slot_kind: "course", class_id: "class-1", school_id: "school-1", subject_name: "Latin" },
      catalogs,
    ).classification,
    "ORPHAN",
  );
});

test("AMBIGUOUS si teacher_id historique null — pas d'invention", () => {
  const result = classifyLegacyScheduleRow(
    {
      id: "a1",
      slot_kind: "course",
      school_id: "school-1",
      class_id: "class-1",
      subject_name: "Mathématiques",
      teacher_id: null,
      starts_at: "2026-09-07T07:00:00.000Z",
      ends_at: "2026-09-07T08:00:00.000Z",
    },
    catalogs,
  );
  assert.equal(result.classification, "AMBIGUOUS");
});

test("MIGRATABLE seulement si tout est unique et cohérent", () => {
  const result = classifyLegacyScheduleRow(
    {
      id: "m1",
      slot_kind: "course",
      school_id: "school-1",
      class_id: "class-1",
      subject_name: "Mathématiques",
      teacher_id: "teacher-1",
      starts_at: "2026-09-07T07:00:00.000Z",
      ends_at: "2026-09-07T08:00:00.000Z",
    },
    catalogs,
  );
  assert.equal(result.classification, "MIGRATABLE");
  assert.equal(result.target.schoolCourseId, "course-1");
  assert.equal(result.target.dayOfWeek, 1);
});

test("summary agrège les classes sans backfill", () => {
  const { summary } = classifyLegacyScheduleRows(
    [
      { id: "e", slot_kind: "exam" },
      { id: "o", slot_kind: "course" },
    ],
    catalogs,
  );
  assert.equal(summary.EXAM, 1);
  assert.equal(summary.ORPHAN, 1);
  assert.equal(summary.MIGRATABLE, 0);
});
