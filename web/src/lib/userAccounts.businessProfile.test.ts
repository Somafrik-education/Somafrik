import { describe, expect, it } from "vitest";
import {
  ACCESS_ROLES_NONE_LABEL,
  BUSINESS_PROFILE_KIND_LABELS,
  accountKindLabel,
  canAssignRoleToUserAccount,
  formatAccessRolesDisplay,
  formatBusinessProfileKind,
  isStudentLinkedAccount,
  isTeacherRoleLabel,
  isUnassignedUserAccount,
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

const studentLoginNoAccessRole: UserAccount = {
  id: "user-student-empty",
  publicId: "CD-ITS-MR-26-00003",
  accountKind: "student_login",
  linkedStudent: { studentId: "stu-1", studentCode: "CD-ITS-MR-26-00003", status: "active" },
  roles: [],
  roleKeys: [],
  assignmentStatus: "",
  role: "",
};

const studentHydratedSansAffectation: UserAccount = {
  id: "user-student-hydrated",
  publicId: "CD-ITS-MR-26-00003",
  accountKind: "student_login",
  linkedStudent: { studentCode: "CD-ITS-MR-26-00003", status: "active" },
  roles: [],
  roleKeys: [],
  assignmentStatus: "Sans affectation",
  role: "Sans affectation",
};

const staff: UserAccount = {
  id: "user-staff",
  publicId: "CD-ITS-AB-26-00001",
  accountKind: "unassigned",
  assignmentStatus: "Sans affectation",
  roles: [],
  roleKeys: [],
};

const teacher: UserAccount = {
  id: "user-teacher",
  accountKind: "teacher",
  linkedTeacher: { teacherId: "t1", teacherCode: "ENS-1", status: "active" },
  roleKeys: ["TEACHER"],
  assignmentStatus: "Enseignant",
  role: "Enseignant",
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

  it("élève lié sans rôle d'accès : type métier Élève, jamais Sans affectation", () => {
    expect(formatBusinessProfileKind(studentLoginNoAccessRole)).toBe(BUSINESS_PROFILE_KIND_LABELS.student_login);
    expect(formatAccessRolesDisplay(studentLoginNoAccessRole)).toBe(ACCESS_ROLES_NONE_LABEL);
    expect(formatBusinessProfileKind(studentLoginNoAccessRole)).not.toBe("Sans affectation");
    expect(isUnassignedUserAccount(studentLoginNoAccessRole)).toBe(false);

    expect(formatBusinessProfileKind(studentHydratedSansAffectation)).toBe("Compte lié à un élève");
    expect(formatAccessRolesDisplay(studentHydratedSansAffectation)).toBe(ACCESS_ROLES_NONE_LABEL);
    expect(isUnassignedUserAccount(studentHydratedSansAffectation)).toBe(false);

    expect(
      formatBusinessProfileKind({
        ...studentHydratedSansAffectation,
        businessProfileLabel: "Sans affectation",
      }),
    ).toBe("Compte lié à un élève");
  });

  it("élève lié + rôle STUDENT : type et accès cohérents", () => {
    expect(formatBusinessProfileKind(studentLogin)).toBe("Compte lié à un élève");
    expect(formatAccessRolesDisplay(studentLogin)).toBe("Élève / Étudiant");
  });

  it("staff sans rôle : Sans affectation autorisé comme type métier", () => {
    expect(formatBusinessProfileKind(staff)).toBe("Sans affectation");
    expect(formatAccessRolesDisplay(staff)).toBe(ACCESS_ROLES_NONE_LABEL);
    expect(isUnassignedUserAccount(staff)).toBe(true);
  });

  it("enseignant lié : type Profil enseignant", () => {
    expect(formatBusinessProfileKind(teacher)).toBe("Profil enseignant");
    expect(formatAccessRolesDisplay(teacher)).toBe("Enseignant");
    expect(isUnassignedUserAccount(teacher)).toBe(false);
  });

  it("conflit : libellé explicite et grant Enseignant bloqué", () => {
    const conflict: UserAccount = {
      accountKind: "conflict",
      linkedStudent: { studentCode: "CD-ITS-MR-26-00003" },
      linkedTeacher: { teacherCode: "ENS-X" },
      businessProfileConflict: true,
    };
    expect(formatBusinessProfileKind(conflict)).toBe("Conflit élève + enseignant");
    expect(canAssignRoleToUserAccount(conflict, "Enseignant")).toBe(false);
    expect(isUnassignedUserAccount(conflict)).toBe(false);
  });

  it("élève inactif sans lien : type métier Sans affectation ; rôle STUDENT sans fiche ≠ élève", () => {
    const inactive: UserAccount = { accountKind: "unassigned", roleKeys: [], assignmentStatus: "Sans affectation" };
    expect(formatBusinessProfileKind(inactive)).toBe("Sans affectation");
    expect(isUnassignedUserAccount(inactive)).toBe(true);

    const studentKeyOnly: UserAccount = { roleKeys: ["STUDENT"] };
    expect(formatBusinessProfileKind(studentKeyOnly)).not.toBe(BUSINESS_PROFILE_KIND_LABELS.student_login);
    expect(isStudentLinkedAccount(studentKeyOnly)).toBe(false);
  });
});
