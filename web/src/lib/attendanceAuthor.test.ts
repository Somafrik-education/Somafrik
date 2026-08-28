import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_PEDAGOGICAL_TEACHER_COPY,
  attachAttendanceTeacherToPayload,
  explicitAttendanceTeacherId,
  resolvePedagogicalAttendanceTeacher,
} from "./attendanceAuthor";

const identity = { classId: "uuid-a", classCode: "CLS-A" };

describe("resolvePedagogicalAttendanceTeacher", () => {
  it("session Enseignant : principal JWT, aucun teacherId forgé", () => {
    const decision = resolvePedagogicalAttendanceTeacher({
      role: "Enseignant",
      assignments: [{ teacherId: "ENS-OTHER", classId: "uuid-a", status: "active" }],
      identity,
    });
    expect(decision).toEqual({ status: "teacher_session" });
    expect(explicitAttendanceTeacherId(decision)).toBeUndefined();
  });

  it("admin : une affectation active → teacherId pédagogique auto", () => {
    const decision = resolvePedagogicalAttendanceTeacher({
      role: "Préfet des études",
      assignments: [
        { teacherId: "ENS-0001", teacherName: "Seke", classId: "uuid-a", classCode: "CLS-A", status: "active" },
      ],
      identity,
    });
    expect(decision).toEqual({ status: "auto", teacherId: "ENS-0001" });
  });

  it("admin : aucune affectation → bloqué, pas d'invention", () => {
    const decision = resolvePedagogicalAttendanceTeacher({
      role: "Admin School",
      assignments: [],
      identity,
    });
    expect(decision).toEqual({
      status: "blocked",
      message: ATTENDANCE_PEDAGOGICAL_TEACHER_COPY.none,
    });
  });

  it("admin : plusieurs enseignants → sélection obligatoire", () => {
    const decision = resolvePedagogicalAttendanceTeacher({
      role: "Admin School",
      assignments: [
        { teacherId: "ENS-A", classId: "uuid-a", status: "active" },
        { teacherId: "ENS-B", classId: "uuid-a", status: "active" },
      ],
      identity,
    });
    expect(decision.status).toBe("need_selection");
    if (decision.status !== "need_selection") return;
    expect(decision.options.map((option) => option.teacherId)).toEqual(["ENS-A", "ENS-B"]);
  });

  it("n'utilise jamais authorId comme enseignant pédagogique", () => {
    const source = `${resolvePedagogicalAttendanceTeacher.toString()}${attachAttendanceTeacherToPayload.toString()}`;
    expect(source).not.toMatch(/authorId/);
  });
});

describe("attachAttendanceTeacherToPayload", () => {
  it("pose teacherId sur le lot et chaque item ; no-op si session enseignant", () => {
    const items = [{ studentId: "s1" }, { studentId: "s2" }];
    expect(attachAttendanceTeacherToPayload({ classId: "uuid-a", items })).toEqual({
      classId: "uuid-a",
      items,
    });
    const attached = attachAttendanceTeacherToPayload({ classId: "uuid-a", items }, "ENS-0001");
    expect(attached.teacherId).toBe("ENS-0001");
    expect(attached.items).toEqual([
      { studentId: "s1", teacherId: "ENS-0001" },
      { studentId: "s2", teacherId: "ENS-0001" },
    ]);
  });
});
