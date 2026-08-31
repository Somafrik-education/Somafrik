"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachEnrollmentMembershipScope,
  resolveEnrollmentSchoolScope,
  assertEnrollmentReadable,
  resolveEnrollmentWriteSchool,
  projectEnrollmentApiStudent,
} = require("./enrollmentSchoolScope");

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

test("ENR: leftover JWT n'est plus l'autorité Enrollment", () => {
  const scope = resolveEnrollmentSchoolScope({
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    sub: "user-a",
  });
  assert.equal(scope.mode, "none");
});

test("ENR: membership login_code + school_id sont l'autorité", () => {
  const scope = resolveEnrollmentSchoolScope({
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    enrollmentLoginCode: LOGIN_A,
    enrollmentSchoolId: SCHOOL_ID_A,
    sub: "user-a",
  });
  assert.equal(scope.mode, "school");
  assert.equal(scope.loginCode, LOGIN_A);
  assert.equal(scope.schoolId, SCHOOL_ID_A);
});

test("ENR: attach lit users.school_id → login_code", async () => {
  const one = async () => ({ school_id: SCHOOL_ID_A, login_code: LOGIN_A });
  const attached = await attachEnrollmentMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A, sub: "user-a" },
    one,
  );
  assert.equal(attached.enrollmentLoginCode, LOGIN_A);
  assert.equal(attached.enrollmentSchoolId, SCHOOL_ID_A);
});

test("ENR: attach sans sub / sans school_id / login_code vide fail-closed", async () => {
  const empty = await attachEnrollmentMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A },
    async () => ({ school_id: SCHOOL_ID_A, login_code: LOGIN_A }),
  );
  assert.equal(empty.enrollmentLoginCode, "");
  const noSchool = await attachEnrollmentMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A, sub: "user-ns" },
    async () => ({ school_id: null, login_code: LOGIN_A }),
  );
  assert.equal(noSchool.enrollmentLoginCode, "");
  const noLogin = await attachEnrollmentMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A, sub: "user-nl" },
    async () => ({ school_id: SCHOOL_ID_A, login_code: null }),
  );
  assert.equal(noLogin.enrollmentLoginCode, "");
  assert.throws(() => assertEnrollmentReadable(empty), (error) => error.statusCode === 403);
});

test("ENR: schoolId UUID A accepté ; UUID B / login B refusés", async () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    enrollmentLoginCode: LOGIN_A,
    enrollmentSchoolId: SCHOOL_ID_A,
    sub: "user-a",
  };
  const same = await resolveEnrollmentWriteSchool(principal, { schoolId: SCHOOL_ID_A }, async () => {
    throw new Error("membership UUID ne doit pas lancer de lookup");
  });
  assert.equal(same.loginCode, LOGIN_A);
  await assert.rejects(
    () => resolveEnrollmentWriteSchool(principal, { schoolId: SCHOOL_ID_B }, async () => null),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => resolveEnrollmentWriteSchool(principal, { schoolCode: LOGIN_B }, async () => null),
    (error) => error.statusCode === 400 && /contradictoire/i.test(error.message),
  );
  await assert.rejects(
    () => resolveEnrollmentWriteSchool(principal, { schoolCode: "HACK" }, async () => null),
    (error) => error.statusCode === 400 && /contradictoire/i.test(error.message),
  );
});

test("ENR: projection API émet login_code", () => {
  const projected = projectEnrollmentApiStudent(
    { id: "STU-A", schoolCode: LEFTOVER_A },
    { loginCode: LOGIN_A },
  );
  assert.equal(projected.schoolCode, LOGIN_A);
});
