import { describe, expect, it } from "vitest";
import {
  ALL_COURSES_FILTER,
  filterParentGrades,
  formatParentClassLabel,
  isParentLinkedStudentId,
  isParentNotesRole,
  parentCourseOptions,
  parentLinkedStudents,
} from "./parentNotes";
import type { SessionUser, StudentGrade } from "../types";

const schoolState = {
  students: [
    {
      id: "stu-a",
      name: "Maeve Okito",
      firstName: "Maeve",
      lastName: "Okito",
      className: "1ère A",
      schoolCode: "SCH-001",
      schoolId: "school-1",
      matricule: "CD-IN-EL-26-001",
    },
    {
      id: "stu-a2",
      name: "Lina Okito",
      firstName: "Lina",
      lastName: "Okito",
      className: "3ème B",
      schoolCode: "SCH-001",
      schoolId: "school-1",
      matricule: "CD-IN-EL-26-002",
    },
    {
      id: "stu-b",
      name: "Élève B",
      className: "1ère A",
      schoolCode: "SCH-001",
      schoolId: "school-1",
      matricule: "CD-IN-EL-26-099",
    },
  ],
};

const parentA: SessionUser = {
  id: "parent-a",
  role: "Parent",
  roleKeys: ["PARENT"],
  schoolCode: "SCH-001",
  schoolId: "school-1",
  schoolPublicCode: "CD02",
  children: [schoolState.students[0]],
};

const parentTwo: SessionUser = {
  ...parentA,
  id: "parent-two",
  children: [schoolState.students[0], schoolState.students[1]],
};

describe("parentNotes — portée enfants", () => {
  it("Parent A ne voit que l'enfant A", () => {
    const children = parentLinkedStudents(parentA, schoolState);
    expect(children.map((row) => row.id)).toEqual(["stu-a"]);
  });

  it("Parent avec deux enfants ne voit que A1 et A2", () => {
    const children = parentLinkedStudents(parentTwo, schoolState);
    expect(children.map((row) => row.id)).toEqual(["stu-a", "stu-a2"]);
  });

  it("Parent A ne voit aucun élève de la classe autre que ses enfants", () => {
    const children = parentLinkedStudents(parentA, schoolState);
    expect(children.some((row) => row.id === "stu-b")).toBe(false);
  });

  it("studentId enfant B n'est pas lié", () => {
    expect(isParentLinkedStudentId(parentA, "stu-b", schoolState)).toBe(false);
    expect(isParentLinkedStudentId(parentA, "stu-a", schoolState)).toBe(true);
  });

  it("Teacher/Admin ne sont pas en mode Parent", () => {
    expect(isParentNotesRole({ id: "t", role: "Enseignant", roleKeys: ["TEACHER"] })).toBe(false);
    expect(isParentNotesRole({ id: "a", role: "Admin School", roleKeys: ["SCHOOL_ADMIN"] })).toBe(false);
    expect(isParentNotesRole(parentA)).toBe(true);
  });

  it("classe lecture seule : libellé 1ère A CD02", () => {
    expect(formatParentClassLabel(schoolState.students[0], "CD02")).toBe("1ère A CD02");
  });

  it("sélecteur Cours : Tous les cours + matières de l'enfant", () => {
    const grades: StudentGrade[] = [
      {
        id: "g1",
        schoolCode: "SCH-001",
        studentId: "stu-a",
        evaluationId: "e1",
        subject: "Mathématiques",
        period: "Trimestre 1",
        value: 16,
        scale: 20,
        gradeStatus: "Validée",
      },
      {
        id: "g2",
        schoolCode: "SCH-001",
        studentId: "stu-a",
        evaluationId: "e2",
        subject: "Français",
        period: "Trimestre 1",
        value: 14,
        scale: 20,
        gradeStatus: "Validée",
      },
    ];
    expect(parentCourseOptions(grades).map((row) => row.label)).toEqual([
      "Tous les cours",
      "Français",
      "Mathématiques",
    ]);
    expect(parentCourseOptions(grades)[0].value).toBe(ALL_COURSES_FILTER);
  });

  it("filtre notes : uniquement l'enfant et le cours choisi", () => {
    const grades: StudentGrade[] = [
      {
        id: "g-a-math",
        schoolCode: "SCH-001",
        studentId: "stu-a",
        evaluationId: "e1",
        subject: "Mathématiques",
        period: "Trimestre 1",
        value: 16,
        scale: 20,
        gradeStatus: "Validée",
      },
      {
        id: "g-b-math",
        schoolCode: "SCH-001",
        studentId: "stu-b",
        evaluationId: "e1",
        subject: "Mathématiques",
        period: "Trimestre 1",
        value: 4,
        scale: 20,
        gradeStatus: "Validée",
      },
    ];
    expect(filterParentGrades(grades, "stu-a", "Trimestre 1", "Mathématiques").map((row) => row.id)).toEqual([
      "g-a-math",
    ]);
  });
});
