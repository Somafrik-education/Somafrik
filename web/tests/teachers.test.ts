import { describe, it, expect } from "vitest";

import {
  prepareAssignmentForSave,
  validateAssignmentConflict,
} from "../src/lib/assignments";
import { validateCourseTeacherRule, canSchoolAdminMutateTeachers } from "../src/lib/pedagogyGovernance";
import { validateTeacherDeletion } from "../src/lib/teacherRules";
import type { BackOfficeState } from "../src/types";

const teachers = [
  { id: "TCH-1", firstName: "Paul", name: "Mukendi", schoolCode: "SCH1" },
  { id: "TCH-2", firstName: "Marie", name: "Kabila", schoolCode: "SCH1" },
];

const classes = [{ id: "CLS-1", name: "6A", schoolCode: "SCH1" }];

const courses = [{ id: "CRS-1", name: "Maths", className: "6A", schoolCode: "SCH1" }];

const assignments = [
  { id: "ASG-1", teacherId: "TCH-1", teacherName: "Paul Mukendi", className: "6A", subject: "Maths", schoolCode: "SCH1" },
];

const state = {
  schools: [{ code: "SCH1", name: "École 1" }],
  classes,
  courses,
  assignments,
  teachers,
  academicConfigs: {
    SCH1: {
      classNames: ["6A"],
      subjectsByClass: { "6A": ["Maths", "Français"] },
      userRoles: ["Enseignant"],
    },
  },
} as unknown as BackOfficeState;

describe("Enseignants — affectations", () => {
  it("prépare une affectation valide", () => {
    const prepared = prepareAssignmentForSave(
      { teacherId: "TCH-1", className: "6A", subject: "Français" },
      teachers,
      "SCH1",
      state,
    );
    expect(prepared.teacherName).toBe("Paul Mukendi");
    expect(prepared.schoolCode).toBe("SCH1");
    expect(prepared.course).toBe("Français");
  });

  it("rejette une affectation sans enseignant", () => {
    expect(
      validateAssignmentConflict(
        { teacherId: "", className: "6A", subject: "Maths" },
        assignments,
        courses,
        classes,
        teachers,
        undefined,
        state,
        "SCH1",
      ),
    ).toMatch(/enseignant/i);
  });

  it("rejette une affectation en doublon pour le même enseignant", () => {
    expect(
      validateAssignmentConflict(
        { teacherId: "TCH-1", className: "6A", subject: "Maths" },
        assignments,
        courses,
        classes,
        teachers,
        undefined,
        state,
        "SCH1",
      ),
    ).toMatch(/déjà affecté/i);
  });

  it("rejette une affectation en conflit avec un autre enseignant", () => {
    expect(
      validateAssignmentConflict(
        { teacherId: "TCH-2", className: "6A", subject: "Maths" },
        assignments,
        courses,
        classes,
        teachers,
        undefined,
        state,
        "SCH1",
      ),
    ).toMatch(/autre enseignant/i);
  });

  it("applique la règle un cours = un enseignant", () => {
    expect(
      validateCourseTeacherRule(
        { className: "6A", name: "Maths", teacherId: "TCH-2" },
        courses,
        assignments,
      ),
    ).toMatch(/déjà affecté/i);
  });

  it("autorise Admin School à créer mais pas modifier les enseignants", () => {
    expect(canSchoolAdminMutateTeachers("CREATE")).toBe(true);
    expect(canSchoolAdminMutateTeachers("READ")).toBe(true);
    expect(canSchoolAdminMutateTeachers("UPDATE")).toBe(false);
    expect(canSchoolAdminMutateTeachers("DELETE")).toBe(false);
  });

  it("refuse la suppression d'un enseignant avec affectations", () => {
    const message = validateTeacherDeletion(state, teachers[0]);
    expect(message).toMatch(/affectation|matière/i);
  });
});
