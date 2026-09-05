"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  BUSINESS_PROFILE_CONFLICT,
  STUDENT_TO_TEACHER_MESSAGE,
  TEACHER_TO_STUDENT_MESSAGE,
  findActiveStudentProfileForUser,
  findActiveTeacherProfileForUser,
  buildBusinessProfile,
  resolveAccountKind,
  studentToTeacherConflict,
  teacherToStudentConflict,
  isBusinessProfileConflictError,
  userMatchesStudentCode,
} = require("./businessProfileIntegrity");

const SAMPLE_IDENTITY = "CD-ITS-MR-26-00003";

describe("businessProfileIntegrity", () => {
  it("reconnaît le format d'identité incident sans le hardcoder comme utilisateur production", () => {
    assert.match(SAMPLE_IDENTITY, /^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-\d{2}-\d{5}$/);
    const user = { user_code: SAMPLE_IDENTITY, school_id: "school-a" };
    assert.equal(userMatchesStudentCode(user, SAMPLE_IDENTITY), true);
    assert.equal(userMatchesStudentCode(user, "CD-ITS-MR-26-00004"), false);
  });

  it("lie un élève actif au compte via user_code / identity_code / login_code, isolé au tenant", () => {
    const students = [
      { id: "stu-a", school_id: "school-a", student_code: SAMPLE_IDENTITY, status: "active" },
      { id: "stu-b", school_id: "school-b", student_code: SAMPLE_IDENTITY, status: "active" },
      { id: "stu-inactive", school_id: "school-a", student_code: "CD-ITS-XX-26-00001", status: "inactive" },
    ];
    const userA = { id: "user-a", school_id: "school-a", user_code: SAMPLE_IDENTITY };
    assert.equal(findActiveStudentProfileForUser(students, userA, "school-a")?.id, "stu-a");
    assert.equal(findActiveStudentProfileForUser(students, userA, "school-b"), null);

    const userViaIdentity = { id: "user-i", school_id: "school-a", identity_code: SAMPLE_IDENTITY };
    assert.equal(findActiveStudentProfileForUser(students, userViaIdentity, "school-a")?.id, "stu-a");

    const inactiveUser = { id: "user-x", school_id: "school-a", user_code: "CD-ITS-XX-26-00001" };
    assert.equal(findActiveStudentProfileForUser(students, inactiveUser, "school-a"), null);
  });

  it("détecte un enseignant actif du même tenant seulement", () => {
    const teachers = [
      { id: "t-a", school_id: "school-a", user_id: "user-1", teacher_code: "ENS-A", status: "active" },
      { id: "t-b", school_id: "school-b", user_id: "user-1", teacher_code: "ENS-B", status: "active" },
      { id: "t-off", school_id: "school-a", user_id: "user-2", teacher_code: "ENS-OFF", status: "inactive" },
    ];
    assert.equal(findActiveTeacherProfileForUser(teachers, "user-1", "school-a")?.id, "t-a");
    assert.equal(findActiveTeacherProfileForUser(teachers, "user-1", "school-b")?.id, "t-b");
    assert.equal(findActiveTeacherProfileForUser(teachers, "user-2", "school-a"), null);
  });

  it("distingue compte technique élève, staff, enseignant et conflit", () => {
    assert.equal(resolveAccountKind({ roleKeys: [] }), "unassigned");
    assert.equal(
      buildBusinessProfile({
        studentRow: { id: "s1", student_code: SAMPLE_IDENTITY, status: "active" },
        roleKeys: [],
      }).accountKind,
      "student_login",
    );
    assert.equal(
      buildBusinessProfile({
        teacherRow: { id: "t1", teacher_code: "ENS-1", status: "active" },
        roleKeys: ["TEACHER"],
      }).accountKind,
      "teacher",
    );
    const conflict = buildBusinessProfile({
      studentRow: { id: "s1", student_code: SAMPLE_IDENTITY, status: "active" },
      teacherRow: { id: "t1", teacher_code: "ENS-1", status: "active" },
      roleKeys: ["TEACHER"],
    });
    assert.equal(conflict.accountKind, "conflict");
    assert.equal(conflict.businessProfileConflict, true);
  });

  it("expose un code métier stable 409 dans les deux directions", () => {
    const student = studentToTeacherConflict({ id: "s1", student_code: SAMPLE_IDENTITY });
    assert.equal(student.status, 409);
    assert.equal(student.code, BUSINESS_PROFILE_CONFLICT);
    assert.equal(student.message, STUDENT_TO_TEACHER_MESSAGE);
    assert.equal(student.details.direction, "student_to_teacher");

    const teacher = teacherToStudentConflict({ id: "t1", teacher_code: "ENS-1" });
    assert.equal(teacher.status, 409);
    assert.equal(teacher.code, BUSINESS_PROFILE_CONFLICT);
    assert.equal(teacher.message, TEACHER_TO_STUDENT_MESSAGE);
    assert.equal(teacher.details.direction, "teacher_to_student");

    assert.equal(isBusinessProfileConflictError({ code: BUSINESS_PROFILE_CONFLICT }), true);
    assert.equal(isBusinessProfileConflictError({ message: "BUSINESS_PROFILE_CONFLICT: dual" }), true);
    assert.equal(isBusinessProfileConflictError({ code: "OTHER" }), false);
  });

  it("ne référence pas les colonnes identity_code / login_code en SQL nu (schémas IT sans ces colonnes)", () => {
    const {
      SELECT_ACTIVE_STUDENT_FOR_USER_SQL,
      SELECT_STUDENT_PROFILES_FOR_USERS_SQL,
      SELECT_ACTIVE_TEACHER_OCCUPYING_CODE_SQL,
      isOptionalProfileLookupError,
    } = require("./businessProfileIntegrity");
    for (const sql of [
      SELECT_ACTIVE_STUDENT_FOR_USER_SQL,
      SELECT_STUDENT_PROFILES_FOR_USERS_SQL,
      SELECT_ACTIVE_TEACHER_OCCUPYING_CODE_SQL,
    ]) {
      assert.match(sql, /to_jsonb\(u\)->>'identity_code'/);
      assert.match(sql, /to_jsonb\(u\)->>'login_code'/);
      assert.doesNotMatch(sql, /u\.identity_code/);
      assert.doesNotMatch(sql, /u\.login_code/);
    }
    assert.equal(isOptionalProfileLookupError({ code: "42703" }), true);
    assert.equal(isOptionalProfileLookupError({ code: "42P01" }), true);
    assert.equal(isOptionalProfileLookupError({ code: "23505" }), false);
  });
});
