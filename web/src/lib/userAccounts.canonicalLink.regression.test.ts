/**
 * student-user-canonical-link.regression — Web
 *
 * Distingue profil métier (linkedStudent / accountKind) et rôle d'accès (roleKeys).
 * W3 : rôle STUDENT sans fiche ≠ Compte lié à un élève.
 */
import { describe, expect, it } from "vitest";
import type { UserAccount } from "../types";
import {
  ACCESS_ROLES_NONE_LABEL,
  BUSINESS_PROFILE_KIND_LABELS,
  formatAccessRolesDisplay,
  formatBusinessProfileKind,
  formatLockedRolesDisplay,
  areStudentRolesLocked,
  canAssignRoleToUserAccount,
  isStudentLinkedAccount,
  isUnassignedUserAccount,
  STUDENT_ROLES_LOCKED_LABEL,
  STUDENT_ACCESS_ROLE_LABEL,
} from "./userAccounts";

const CODE_A = "CD-ITS-MR-26-00099";
const CODE_B = "CD-ITS-MR-26-00003";
const S1 = "22222222-2222-4222-8222-222222222222";

const linkedNoAccess: UserAccount = {
  id: "user-u1",
  publicId: CODE_A,
  identifier: CODE_A,
  firstName: "Marc",
  lastName: "Rumba",
  accountKind: "student_login",
  businessProfileLabel: "Compte lié à un élève",
  linkedStudent: { studentId: S1, studentCode: CODE_B, status: "active" },
  linkedTeacher: null,
  roleKeys: [],
  roles: [],
  role: "",
  assignmentStatus: "",
};

describe("W1 — accountKind student_login + linkedStudent + roleKeys=[]", () => {
  it("affiche Compte lié à un élève, jamais Sans affectation", () => {
    expect(formatBusinessProfileKind(linkedNoAccess)).toBe(BUSINESS_PROFILE_KIND_LABELS.student_login);
    expect(formatBusinessProfileKind(linkedNoAccess)).not.toBe("Sans affectation");
    expect(isUnassignedUserAccount(linkedNoAccess)).toBe(false);
    expect(formatAccessRolesDisplay(linkedNoAccess)).toBe("Élève / Étudiant");
  });
});

describe("W2 — linkedStudent sans rôle ni role label", () => {
  it("conserve le profil métier élève", () => {
    const row: UserAccount = { ...linkedNoAccess, role: "", roles: [], roleKeys: [] };
    expect(formatBusinessProfileKind(row)).toBe("Compte lié à un élève");
    expect(isStudentLinkedAccount(row)).toBe(true);
  });
});

describe("W3 — rôle STUDENT sans fiche students", () => {
  const roleOnly: UserAccount = {
    id: "user-role-only",
    publicId: CODE_A,
    identifier: CODE_A,
    accountKind: "unassigned",
    businessProfileLabel: "Sans affectation",
    linkedStudent: null,
    linkedTeacher: null,
    roleKeys: ["STUDENT"],
    roles: [],
    role: "",
  };

  it("explicite la distinction d'entrée : rôle ≠ linkedStudent", () => {
    expect(roleOnly.linkedStudent).toBeNull();
    expect(roleOnly.accountKind).toBe("unassigned");
    expect(roleOnly.roleKeys).toEqual(["STUDENT"]);
    expect(linkedNoAccess.linkedStudent?.studentId).toBe(S1);
    expect(roleOnly.accountKind).not.toBe(linkedNoAccess.accountKind);
    expect(Boolean(roleOnly.linkedStudent)).not.toBe(Boolean(linkedNoAccess.linkedStudent));
  });

  it("W3 contract : roleKeys STUDENT + linkedStudent null + accountKind unassigned ≠ Compte lié à un élève", () => {
      expect(formatBusinessProfileKind(roleOnly)).not.toBe(BUSINESS_PROFILE_KIND_LABELS.student_login);
      expect(isStudentLinkedAccount(roleOnly)).toBe(false);
    });
});

describe("W4 — studentCode divergent de l'identifiant compte", () => {
  it("le Web utilise linkedStudent fourni, sans reconstruire par identifier", () => {
    expect(linkedNoAccess.linkedStudent?.studentCode).not.toBe(linkedNoAccess.identifier);
    expect(linkedNoAccess.linkedStudent?.studentCode).not.toBe(linkedNoAccess.publicId);
    expect(formatBusinessProfileKind(linkedNoAccess)).toBe("Compte lié à un élève");
    expect(isStudentLinkedAccount(linkedNoAccess)).toBe(true);
    expect(linkedNoAccess.linkedStudent?.studentId).toBe(S1);
    expect(linkedNoAccess.linkedStudent?.studentCode).toBe(CODE_B);
  });

  it("cas réel 6654 1324 / CD-IN-61-26-00017 : linkedStudent.studentId, jamais égalité de codes", () => {
    const row: UserAccount = {
      ...linkedNoAccess,
      id: "17171717-1717-4717-8717-171717171717",
      publicId: "6654 1324",
      identifier: "6654 1324",
      linkedStudent: {
        studentId: "18181818-1818-4818-8818-181818181818",
        studentCode: "CD-IN-61-26-00017",
        status: "active",
      },
    };
    expect(formatBusinessProfileKind(row)).toBe("Compte lié à un élève");
    expect(row.linkedStudent?.studentId).toBe("18181818-1818-4818-8818-181818181818");
    expect(row.identifier).not.toBe(row.linkedStudent?.studentCode);
    expect(areStudentRolesLocked(row)).toBe(true);
    expect(formatAccessRolesDisplay(row)).toBe(STUDENT_ACCESS_ROLE_LABEL);
    expect(formatLockedRolesDisplay(row)).toBe(STUDENT_ROLES_LOCKED_LABEL);
    expect(canAssignRoleToUserAccount(row, "Directeur")).toBe(false);
    expect(canAssignRoleToUserAccount(row, "Enseignant")).toBe(false);
    expect(canAssignRoleToUserAccount(row, "Admin School")).toBe(false);
  });
});
