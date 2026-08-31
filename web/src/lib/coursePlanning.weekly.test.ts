import { describe, expect, it } from "vitest";
import { PLANNING_WEB_UI_ENABLED } from "./constants";
import { canReadView, type PermissionContext } from "./permissions";
import {
  PLANNING_WEEKDAYS,
  detectScheduleConflicts,
  expandScheduleOccurrences,
  isoWeekdayFromLocalDate,
  mapServerOccurrencesToCalendarEvents,
  scopedCourseSchedules,
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
  it("PLANNING_WEB_UI_ENABLED est true (réexposition contrôlée)", () => {
    expect(PLANNING_WEB_UI_ENABLED).toBe(true);
  });

  it("canReadView(planning) autorise Admin avec Planning de cours:READ", () => {
    expect(canReadView(adminWithPlanning, "planning")).toBe(true);
  });

  it("dimanche métier = 7, jamais Date.getDay()=0", () => {
    const weekdayValues: number[] = PLANNING_WEEKDAYS.map((row) => row.value);
    expect(weekdayValues).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("isoWeekdayFromLocalDate : dimanche local = 7, jamais 0", () => {
    const sunday = new Date(2026, 8, 6, 10, 0, 0);
    expect(isoWeekdayFromLocalDate(sunday)).toBe(7);
    const monday = new Date(2026, 8, 7, 10, 0, 0);
    expect(isoWeekdayFromLocalDate(monday)).toBe(1);
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

  it("mapServerOccurrencesToCalendarEvents recopie start/end serveur sans ré-expandre", () => {
    const events = mapServerOccurrencesToCalendarEvents(
      [
        {
          id: "slot-1__2026-09-07",
          scheduleId: "slot-1",
          occurrenceDate: "2026-09-07",
          start: "2026-09-07T07:00:00.000Z",
          end: "2026-09-07T08:00:00.000Z",
          className: "2ème A",
          subject: "Mathématiques",
          courseName: "Mathématiques",
          teacherName: "Seke Kilombo",
          dayOfWeek: 1,
          startTime: "08:00",
          endTime: "09:00",
          status: "active",
          schoolCode: "CD-2026-0001",
        },
        {
          id: "slot-1__2026-09-08",
          scheduleId: "slot-1",
          start: "2026-09-08T07:00:00.000Z",
          end: "2026-09-08T08:00:00.000Z",
          className: "2ème B",
          subject: "Mathématiques",
          status: "active",
        },
        {
          id: "slot-2__2026-09-07",
          scheduleId: "slot-2",
          start: "2026-09-07T09:00:00.000Z",
          end: "2026-09-07T10:00:00.000Z",
          className: "2ème A",
          subject: "Mathématiques",
          status: "cancelled",
        },
      ],
      "2ème A",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("slot-1__2026-09-07");
    expect(events[0]?.start).toBe("2026-09-07T07:00:00.000Z");
    expect(events[0]?.end).toBe("2026-09-07T08:00:00.000Z");
    expect(events[0]?.extendedProps.id).toBe("slot-1");
  });

  it("scopedCourseSchedules garde la projection login_code malgré leftover JWT", () => {
    const user = { role: "Admin School", schoolCode: "CD-2026-0001" };
    const rows = scopedCourseSchedules(user, {
      courseSchedules: [{ ...weekly, schoolCode: "CD-LAC-26-001", schoolId: "school-a" }],
    } as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.schoolCode).toBe("CD-LAC-26-001");
  });

  it("scopedCourseSchedules matche schools.id quand leftover JWT ≠ login_code", () => {
    const user = { role: "Admin School", schoolCode: "CD-2026-0001", schoolId: "school-a" };
    const rows = scopedCourseSchedules(user, {
      courseSchedules: [{ ...weekly, schoolCode: "CD-LAC-26-001", schoolId: "school-a" }],
    } as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.schoolCode).toBe("CD-LAC-26-001");
  });

  it("scopedCourseSchedules matches by schoolId and public login_code", () => {
    const user = {
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      schoolPublicCode: "CD-LAC-26-001",
      schoolId: "school-a",
    } as never;
    const rows = scopedCourseSchedules(user, {
      courseSchedules: [
        { ...weekly, schoolCode: "CD-LAC-26-001", schoolId: "school-a" },
        { ...weekly, id: "slot-other", schoolCode: "BI-BUJ-26-001", schoolId: "school-b" },
      ],
    } as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.schoolId).toBe("school-a");
    expect(rows[0]?.schoolCode).toBe("CD-LAC-26-001");
  });
});
