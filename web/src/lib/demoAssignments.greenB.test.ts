import { describe, expect, it } from "vitest";
import { SCHOOL_ADMIN_ROLE } from "./orgHierarchy";
import {
  ATTENDANCE_PEDAGOGICAL_TEACHER_COPY,
  resolvePedagogicalAttendanceTeacher,
} from "./attendanceAuthor";
import { toPresenceClassCard } from "./presenceRoster";

const SCHOOL_CODE = "SCH-BULK-CD-0001";
const CLASS_ID = "11111111-1111-4111-8111-111111111111";
const CLASS_CODE = "CLS-1ERE-A";
const TEACHER_ID = "TCH-SCH-BULK-CD-0001-001";

describe("GREEN-B Démo — affectation canonique Présences", () => {
  it("DEMO-PRES-RED-01 — 1ère A avec teacher_assignment active ne doit plus afficher Aucun enseignant", () => {
    const identity = toPresenceClassCard({
      id: CLASS_ID,
      classId: CLASS_ID,
      publicId: CLASS_CODE,
      classCode: CLASS_CODE,
      name: "1ère A",
      className: "1ère A",
      schoolCode: SCHOOL_CODE,
      students: 20,
    });

    expect(identity).toBeTruthy();
    expect(identity?.classId).toBe(CLASS_ID);
    expect(identity?.classCode).toBe(CLASS_CODE);

    const assignment = {
      id: "TA-DEMO-001",
      publicId: "TA-DEMO-001",
      schoolCode: SCHOOL_CODE,
      teacherId: TEACHER_ID,
      teacherName: "Seke Mwamba",
      classId: CLASS_ID,
      classCode: CLASS_CODE,
      className: "1ère A",
      subject: "Mathématiques",
      course: "Mathématiques",
      assignmentRole: "primary",
      status: "active",
    };

    const decision = resolvePedagogicalAttendanceTeacher({
      role: SCHOOL_ADMIN_ROLE,
      assignments: [assignment],
      identity,
      teachers: [
        {
          id: TEACHER_ID,
          publicId: TEACHER_ID,
          name: "Seke Mwamba",
          schoolCode: SCHOOL_CODE,
        },
      ],
    });

    expect(decision).toEqual({ status: "auto", teacherId: TEACHER_ID });
    expect(decision).not.toEqual({
      status: "blocked",
      message: ATTENDANCE_PEDAGOGICAL_TEACHER_COPY.none,
    });
  });

  it("fail-closed — affectation inactive ne doit jamais autoriser l'appel", () => {
    const identity = { classId: CLASS_ID, classCode: CLASS_CODE };
    const decision = resolvePedagogicalAttendanceTeacher({
      role: SCHOOL_ADMIN_ROLE,
      assignments: [
        {
          id: "TA-DEMO-INACTIVE",
          teacherId: TEACHER_ID,
          classId: CLASS_ID,
          classCode: CLASS_CODE,
          status: "inactive",
        },
      ],
      identity,
    });

    expect(decision).toEqual({
      status: "blocked",
      message: ATTENDANCE_PEDAGOGICAL_TEACHER_COPY.none,
    });
  });
});
