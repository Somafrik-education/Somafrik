import { describe, expect, it } from "vitest";
import {
  accountKindLabel,
  canAssignRoleToUserAccount,
  isStudentLinkedAccount,
  isTeacherRoleLabel,
  STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE,
} from "./userAccounts";
import type { UserAccount } from "../types";

const studentLogin: UserAccount = {
  id: "user-student",
  publicId: "CD-ITS-MR-26-00003",
  firstName: "Marc",
  lastName: "Rumba",
  accountKind: "student_login",
  linkedStudent: { studentId: "stu-1", studentCode: "CD-ITS-MR-26-00003", status: "active" },
  assignmentStatus: "Élève / Étudiant",
  role: "Élève / Étudiant",
  roleKeys: ["STUDENT"],
};

const staff: UserAccount = {
  id: "user-staff",
  publicId: "CD-ITS-AB-26-00001",
  accountKind: "unassigned",
  assignmentStatus: "Sans affectation",
};

describe("userAccounts business profile", () => {
  it("distingue un compte technique élève d'un compte staff assignable", () => {
    expect(isStudentLinkedAccount(studentLogin)).toBe(true);
    expect(isStudentLinkedAccount(staff)).toBe(false);
    expect(accountKindLabel(studentLogin)).toBe("Compte lié à un élève");
    expect(accountKindLabel(staff)).toBeNull();
  });

  it("refuse le rôle Enseignant sur un compte lié à un élève, pas sur un staff", () => {
    expect(isTeacherRoleLabel("Enseignant")).toBe(true);
    expect(canAssignRoleToUserAccount(studentLogin, "Enseignant")).toBe(false);
    expect(canAssignRoleToUserAccount(studentLogin, "Secrétaire")).toBe(true);
    expect(canAssignRoleToUserAccount(staff, "Enseignant")).toBe(true);
    expect(STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE).toMatch(/élève actif/i);
  });

  it("traite le format d'identité CD-ITS-MR-26-00003 comme un identifiant, pas un utilisateur production", () => {
    expect(studentLogin.publicId).toMatch(/^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
    expect(studentLogin.linkedStudent?.studentCode).toBe(studentLogin.publicId);
  });
});
