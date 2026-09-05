import assert from "node:assert/strict";
import {
  ACCESS_ROLES_NONE_LABEL,
  BUSINESS_PROFILE_KIND_LABELS,
  accountKindLabel,
  formatAccessRolesDisplay,
  formatBusinessProfileKind,
  isStudentLinkedAccount,
  isTeacherLinkedAccount,
  STUDENT_TEACHER_GRANT_BLOCKED_MESSAGE,
} from "./businessProfile";

const sample = {
  publicId: "CD-ITS-MR-26-00003",
  accountKind: "student_login" as const,
  linkedStudent: { studentCode: "CD-ITS-MR-26-00003" },
};

assert.match(String(sample.publicId), /^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
assert.equal(isStudentLinkedAccount(sample), true);
assert.equal(isTeacherLinkedAccount(sample), false);
assert.equal(accountKindLabel(sample), "Compte lié à un élève");
assert.equal(isStudentLinkedAccount({ accountKind: "unassigned" }), false);
assert.equal(isTeacherLinkedAccount({ role: "Enseignant" }), true);
assert.match(STUDENT_TEACHER_GRANT_BLOCKED_MESSAGE, /élève actif/i);

const studentNoAccess = {
  accountKind: "student_login" as const,
  linkedStudent: { studentId: "stu-1", studentCode: "CD-ITS-MR-26-00003" },
  role: "Sans affectation",
  assignmentStatus: "Sans affectation",
  roles: [] as string[],
  roleKeys: [] as string[],
  activeRoles: [] as string[],
};
assert.equal(formatBusinessProfileKind(studentNoAccess), BUSINESS_PROFILE_KIND_LABELS.student_login);
assert.equal(formatAccessRolesDisplay(studentNoAccess), ACCESS_ROLES_NONE_LABEL);
assert.notEqual(formatBusinessProfileKind(studentNoAccess), "Sans affectation");
assert.equal(accountKindLabel(studentNoAccess), "Compte lié à un élève");

const staffUnassigned = {
  accountKind: "unassigned" as const,
  role: "Sans affectation",
  assignmentStatus: "Sans affectation",
  roleKeys: [] as string[],
};
assert.equal(formatBusinessProfileKind(staffUnassigned), "Sans affectation");
assert.equal(formatAccessRolesDisplay(staffUnassigned), ACCESS_ROLES_NONE_LABEL);
assert.equal(accountKindLabel(staffUnassigned), null);

const teacher = {
  accountKind: "teacher" as const,
  linkedTeacher: { teacherCode: "ENS-1" },
  role: "Enseignant",
  roleKeys: ["TEACHER"],
  activeRoles: ["Enseignant"],
};
assert.equal(formatBusinessProfileKind(teacher), "Profil enseignant");
assert.equal(formatAccessRolesDisplay(teacher), "Enseignant");

const conflict = {
  accountKind: "conflict" as const,
  linkedStudent: { studentCode: "CD-ITS-MR-26-00003" },
  linkedTeacher: { teacherCode: "ENS-X" },
  businessProfileConflict: true,
};
assert.equal(formatBusinessProfileKind(conflict), "Conflit élève + enseignant");

const inactiveNoLink = {
  accountKind: "unassigned" as const,
  roleKeys: [] as string[],
};
assert.equal(formatBusinessProfileKind(inactiveNoLink), "Sans affectation");

const studentRoleOnly = { roleKeys: ["STUDENT"] };
assert.equal(formatBusinessProfileKind(studentRoleOnly), "Compte lié à un élève");

console.log("businessProfile.test.ts OK");
