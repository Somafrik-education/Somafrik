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
assert.doesNotMatch(AUDIT_SQL, /\bINSERT\b/i);
assert.match(AUDIT_SQL, /to_jsonb\(u\)->>'identity_code'/);
assert.match(AUDIT_SQL, /to_jsonb\(u\)->>'login_code'/);
assert.doesNotMatch(AUDIT_SQL, /u\.identity_code/);
assert.doesNotMatch(AUDIT_SQL, /u\.login_code/);

const lifecycle = fs.readFileSync(path.join(__dirname, "../lib/userRoleLifecycleService.js"), "utf8");
assert.match(lifecycle, /BUSINESS_PROFILE_CONFLICT/);
assert.match(lifecycle, /assertBusinessProfileGrantAllowed/);
assert.match(lifecycle, /studentToTeacherConflict/);
assert.match(lifecycle, /teacherToStudentConflict/);

assert.match(lifecycle, /assertCanonicalStudentRolesLocked/);
assert.match(lifecycle, /STUDENT_ROLE_LOCKED/);

const webPage = fs.readFileSync(path.join(__dirname, "../../web/src/pages/UsersPage.tsx"), "utf8");
assert.match(webPage, /accountKindLabel/);
assert.match(webPage, /canAssignRoleToUserAccount/);
assert.match(webPage, /STUDENT_ROLE_LOCKED_MESSAGE/);
assert.match(webPage, /areStudentRolesLocked/);
const webAccounts = fs.readFileSync(path.join(__dirname, "../../web/src/lib/userAccounts.ts"), "utf8");
assert.match(webAccounts, /Compte lié à un élève/);
assert.match(webAccounts, /STUDENT_ROLE_LOCKED/);

const mobile = fs.readFileSync(path.join(__dirname, "../../Mobile/src/components/UserMutationControls.tsx"), "utf8");
assert.match(mobile, /isStudentLinkedAccount/);
assert.match(mobile, /STUDENT_ROLE_LOCKED_MESSAGE/);

const enroll = fs.readFileSync(path.join(__dirname, "../db/classStudentsRepository.js"), "utf8");
assert.match(enroll, /SELECT_ACTIVE_TEACHER_OCCUPYING_CODE_SQL/);
assert.match(enroll, /INSERT INTO user_roles/);
assert.match(enroll, /UPDATE students SET user_id/);
assert.match(enroll, /STUDENT/);

const schema = fs.readFileSync(path.join(__dirname, "../db/userRolesSchema.js"), "utf8");
assert.match(schema, /20260906_business_profile_exclusivity\.sql/);
assert.match(schema, /20260907_student_user_id\.sql/);
assert.match(schema, /20260908_student_role_lock\.sql/);
assert.match(schema, /20260909_student_role_lock_trigger\.sql/);
assert.match(schema, /USER_ROLES_PRELOCK_SCHEMA_SQL/);

const userIdMigration = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260907_student_user_id.sql"),
  "utf8",
);
assert.match(userIdMigration, /check_violation/);
assert.doesNotMatch(userIdMigration, /DROP CONSTRAINT/i);
assert.doesNotMatch(userIdMigration, /VALIDATE CONSTRAINT/i);
const canonical23 = fs.readFileSync(
  path.join(__dirname, "../db/migrations/20260823_student_canonical_identifier.sql"),
  "utf8",
);
assert.doesNotMatch(canonical23, /DROP CONSTRAINT students_canonical_identifier_format_check/);

console.log("audit-student-teacher-dual-profiles static OK");
