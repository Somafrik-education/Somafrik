import { describe, expect, it } from "vitest";
import type { BackOfficeState, SessionUser } from "../types";
import type { CourseScheduleSlot } from "./coursePlanning";
import {
  canonicalSchoolCourseId,
  listSchoolCoursesForClass,
  resolveClassAcademicYearId,
  toWeeklyScheduleWritePayload,
} from "./planningWeeklyWrite";

const admin: SessionUser = {
  id: "admin-1",
  role: "Admin School",
  schoolCode: "CD-2026-0001",
} as SessionUser;

const weekly: CourseScheduleSlot = {
  id: "slot-1",
  schoolCode: "CD-2026-0001",
  className: "2ème A",
  subject: "Mathématiques",
  schoolCourseId: "11111111-1111-4111-8111-111111111111",
  academicYearId: "22222222-2222-4222-8222-222222222222",
  dayOfWeek: 1,
  startTime: "08:00",
  endTime: "09:00",
  start: "",
  end: "",
};

describe("Planning V2 — payload d'écriture Web", () => {
  it("n'envoie que schoolCourseId / academicYearId / dayOfWeek / TIME", () => {
    const payload = toWeeklyScheduleWritePayload(weekly);
    expect(payload).toEqual({
      schoolCourseId: weekly.schoolCourseId,
      academicYearId: weekly.academicYearId,
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "09:00",
    });
    expect(payload).not.toHaveProperty("className");
    expect(payload).not.toHaveProperty("subject");
    expect(payload).not.toHaveProperty("start");
    expect(payload).not.toHaveProperty("end");
  });

  it("refuse className + subject comme autorité", () => {
    expect(() =>
      toWeeklyScheduleWritePayload({
        ...weekly,
        schoolCourseId: "",
      }),
    ).toThrow(/schoolCourseId obligatoire/);
  });

  it("refuse dayOfWeek 0 (Date.getDay dimanche)", () => {
    expect(() => toWeeklyScheduleWritePayload({ ...weekly, dayOfWeek: 0 })).toThrow(/dayOfWeek/);
  });

  it("canonicalSchoolCourseId lit l'UUID du cours, pas le libellé", () => {
    expect(
      canonicalSchoolCourseId({
        id: "CO-legacy",
        schoolCourseId: "33333333-3333-4333-8333-333333333333",
        name: "Mathématiques",
      }),
    ).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("liste les cours actifs d'une classe et l'année de la classe", () => {
    const state = {
      courses: [
        {
          id: "legacy",
          schoolCourseId: "44444444-4444-4444-8444-444444444444",
          schoolCode: "CD-2026-0001",
          className: "2ème A",
          name: "Mathématiques",
          teacherId: "t1",
          teacherName: "Seke",
          status: "Actif",
        },
        {
          schoolCourseId: "55555555-5555-4555-8555-555555555555",
          schoolCode: "CD-2026-0001",
          className: "2ème A",
          name: "Latin",
          status: "Archivé",
        },
      ],
      classes: [
        {
          id: "c1",
          name: "2ème A",
          schoolCode: "CD-2026-0001",
          academicYearId: "66666666-6666-4666-8666-666666666666",
        },
      ],
    } as unknown as BackOfficeState;

    const courses = listSchoolCoursesForClass(admin, state, "2ème A");
    expect(courses.map((row) => row.name)).toEqual(["Mathématiques"]);
    expect(resolveClassAcademicYearId(admin, state, "2ème A")).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
  });
});
