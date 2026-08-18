import { describe, expect, it } from "vitest";
import { PLANNING_WEB_UI_ENABLED } from "./constants";
import { canReadView, type PermissionContext } from "./permissions";
import {
  PLANNING_WEEKDAYS,
  detectScheduleConflicts,
  expandScheduleOccurrences,
  type CourseScheduleSlot,
} from "./coursePlanning";

const adminWithPlanning: PermissionContext = {
  user: {
    id: "admin-1",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    permissions: [
      "Planning de cours:READ",
      "Planning de cours:CREATE",
      "Planning de cours:UPDATE",
      "Planning de cours:DELETE",
    ],
  } as never,
  rolePermissions: {},
};

const weekly: CourseScheduleSlot = {
  id: "slot-1",
  schoolCode: "CD-2026-0001",
  className: "2ème A",
  subject: "Mathématiques",
  courseName: "Mathématiques",
  teacherId: "teacher-1",
  teacherName: "Seke Kilombo",
  schoolCourseId: "course-1",
  academicYearId: "year-1",
  classId: "class-1",
  subjectId: "subject-1",
  dayOfWeek: 1,
  startTime: "08:00",
  endTime: "09:00",
  status: "active",
  start: "",
  end: "",
  kind: "course",
  periodStart: "01-09-2026",
  periodEnd: "30-09-2026",
};

describe("Planning V2 — mapping Web canonique", () => {
  it("PLANNING_WEB_UI_ENABLED reste false", () => {
    expect(PLANNING_WEB_UI_ENABLED).toBe(false);
  });

  it("canReadView(planning) refuse même avec Planning de cours:READ", () => {
    expect(canReadView(adminWithPlanning, "planning")).toBe(false);
  });

  it("dimanche métier = 7, jamais Date.getDay()=0", () => {
    expect(PLANNING_WEEKDAYS.some((row) => row.value === 7 && row.label === "Dimanche")).toBe(true);
    expect(PLANNING_WEEKDAYS.some((row) => row.value === 0)).toBe(false);
  });

  it("expandScheduleOccurrences projette dayOfWeek sans inventer depuis un timestamp", () => {
    const occurrences = expandScheduleOccurrences(weekly);
    expect(occurrences.length).toBe(4);
    const inventedFromGetDay = expandScheduleOccurrences({
      ...weekly,
      dayOfWeek: undefined,
      startTime: undefined,
      endTime: undefined,
      start: "2026-09-01T08:00:00.000Z",
      end: "2026-09-01T09:00:00.000Z",
    });
    expect(inventedFromGetDay).toHaveLength(1);
  });

  it("collisions UI lisent dayOfWeek + TIME, créneaux adjacents autorisés", () => {
    const overlap: CourseScheduleSlot = {
      ...weekly,
      id: "slot-2",
      subject: "Français",
      startTime: "08:30",
      endTime: "09:30",
    };
    expect(detectScheduleConflicts([overlap], weekly).some((row) => row.includes("Conflit sur"))).toBe(true);

    const adjacent: CourseScheduleSlot = {
      ...weekly,
      id: "slot-3",
      subject: "Français",
      startTime: "09:00",
      endTime: "10:00",
    };
    expect(detectScheduleConflicts([adjacent], weekly)).toEqual([]);
  });
});
