"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, AUDIT_SQL, assertReadOnlySource } = require("./audit-student-teacher-dual-profiles");

assert.throws(
  () => parseArgs(["--apply"]),
  (error) => error.code === "AUDIT_WRITE_FORBIDDEN",
);
assert.throws(
  () => parseArgs(["--fix"]),
  (error) => error.code === "AUDIT_WRITE_FORBIDDEN",
);
parseArgs(["--json"]);
assertReadOnlySource();
assert.match(AUDIT_SQL, /JOIN students/i);
assert.match(AUDIT_SQL, /JOIN teachers/i);
assert.doesNotMatch(AUDIT_SQL, /\bUPDATE\b/i);
assert.doesNotMatch(AUDIT_SQL, /\bDELETE\b/i);

const lifecycle = fs.readFileSync(path.join(__dirname, "../lib/userRoleLifecycleService.js"), "utf8");
assert.match(lifecycle, /BUSINESS_PROFILE_CONFLICT/);
assert.match(lifecycle, /assertBusinessProfileGrantAllowed/);
assert.match(lifecycle, /studentToTeacherConflict/);
assert.match(lifecycle, /teacherToStudentConflict/);

const webPage = fs.readFileSync(path.join(__dirname, "../../web/src/pages/UsersPage.tsx"), "utf8");
assert.match(webPage, /accountKindLabel/);
assert.match(webPage, /canAssignRoleToUserAccount/);
assert.match(webPage, /STUDENT_TEACHER_ROLE_CONFLICT_MESSAGE/);
const webAccounts = fs.readFileSync(path.join(__dirname, "../../web/src/lib/userAccounts.ts"), "utf8");
assert.match(webAccounts, /Compte lié à un élève/);

const mobile = fs.readFileSync(path.join(__dirname, "../../Mobile/src/components/UserMutationControls.tsx"), "utf8");
assert.match(mobile, /isStudentLinkedAccount/);
assert.match(mobile, /STUDENT_TEACHER_GRANT_BLOCKED_MESSAGE/);

const enroll = fs.readFileSync(path.join(__dirname, "../db/classStudentsRepository.js"), "utf8");
assert.match(enroll, /SELECT_ACTIVE_TEACHER_OCCUPYING_CODE_SQL/);
assert.match(enroll, /INSERT INTO user_roles/);
assert.match(enroll, /STUDENT/);

const schema = fs.readFileSync(path.join(__dirname, "../db/userRolesSchema.js"), "utf8");
assert.match(schema, /20260906_business_profile_exclusivity\.sql/);

console.log("audit-student-teacher-dual-profiles static OK");
