import assert from "node:assert/strict";
import {
  accountKindLabel,
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
console.log("businessProfile.test.ts OK");
