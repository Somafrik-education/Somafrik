"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachEnrollmentMembershipScope,
  attachEnrollmentFixtureScope,
  resolveEnrollmentSchoolScope,
  filterEnrollmentRows,
  assertEnrollmentReadable,
  assertEnrollmentSchoolCode,
  assertEnrollmentStudentAccess,
  resolveEnrollmentWriteSchool,
  findSchoolForPlatformScope,
  publicSchoolCodeFromRow,
  projectEnrollmentApiStudent,
} = require("./enrollmentSchoolScope");

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

test("ENR: leftover JWT n'est plus l'autorité Enrollment", () => {
  const scope = resolveEnrollmentSchoolScope({
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    sub: "user-uuid",
  });
  assert.equal(scope.mode, "none");
});

test("ENR: membership login_code + school_id sont l'autorité", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    enrollmentLoginCode: LOGIN_A,
    enrollmentSchoolId: SCHOOL_ID_A,
    sub: "user-uuid",
  };
  const scope = resolveEnrollmentSchoolScope(principal);
  assert.equal(scope.mode, "school");
  assert.equal(scope.loginCode, LOGIN_A);
  assert.equal(scope.schoolId, SCHOOL_ID_A);
  const rows = [
    { id: "stu-a", schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A },
    { id: "stu-b", schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B },
  ];
  assert.deepEqual(
    filterEnrollmentRows(rows, scope).map((row) => row.id),
    ["stu-a"],
  );
});

test("ENR: Superadmin global reste global", () => {
  const scope = resolveEnrollmentSchoolScope({
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
  });
  assert.equal(scope.mode, "all");
});

test("ENR: Admin Pays global = pays, jamais leftover schoolCode", () => {
  const scope = resolveEnrollmentSchoolScope({
    role: "Admin Pays",
    countryCode: "CD",
    schoolCode: LEFTOVER_A,
  });
  assert.equal(scope.mode, "country");
  assert.equal(scope.countryCode, "CD");
});

test("ENR: attach lit users.school_id → login_code", async () => {
  const one = async (sql, params) => {
    assert.match(String(sql), /FROM users u/i);
    assert.equal(params[0], "user-a");
    return { school_id: SCHOOL_ID_A, login_code: LOGIN_A };
  };
  const attached = await attachEnrollmentMembershipScope(
    { role: "Admin School", sub: "user-a", schoolCode: LEFTOVER_A },
    one,
  );
  assert.equal(attached.enrollmentLoginCode, LOGIN_A);
  assert.equal(attached.enrollmentSchoolId, SCHOOL_ID_A);
  assert.equal(attached.schoolCode, LEFTOVER_A);
});

test("ENR: attach sans sub fail-closed", async () => {
  const attached = await attachEnrollmentMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A },
    async () => {
      throw new Error("lookup interdit sans sub");
    },
  );
  assert.equal(attached.enrollmentLoginCode, "");
  assert.equal(resolveEnrollmentSchoolScope(attached).mode, "none");
  assert.throws(() => assertEnrollmentReadable(attached), (error) => error.statusCode === 403);
});

test("ENR: attach sans one fail-closed (leftover ignoré)", async () => {
  const attached = await attachEnrollmentMembershipScope(
    { role: "Admin School", sub: "user-a", schoolCode: LEFTOVER_A },
    null,
  );
  assert.equal(attached.enrollmentLoginCode, "");
});

test("ENR: user sans school_id fail-closed", async () => {
  const attached = await attachEnrollmentMembershipScope(
    { role: "Admin School", sub: "user-a", schoolCode: LEFTOVER_A },
    async () => null,
  );
  assert.equal(attached.enrollmentLoginCode, "");
  assert.equal(resolveEnrollmentSchoolScope(attached).mode, "none");
});

test("ENR: login_code vide ne promeut pas leftover", async () => {
  const attached = await attachEnrollmentMembershipScope(
    { role: "Admin School", sub: "user-a", schoolCode: LEFTOVER_A },
    async () => ({ school_id: SCHOOL_ID_A, login_code: "  " }),
  );
  assert.equal(attached.enrollmentLoginCode, "");
  assert.notEqual(attached.enrollmentLoginCode, LEFTOVER_A);
  assert.equal(resolveEnrollmentSchoolScope(attached).mode, "none");
});

test("ENR: rôle établissement request-scoped reste membership UUID", async () => {
  const one = async (sql) => {
    if (/FROM users u/i.test(String(sql))) {
      return { school_id: SCHOOL_ID_A, login_code: LOGIN_A };
    }
    throw new Error("FIND request-scoped interdit pour un rôle établissement");
  };
  const attached = await attachEnrollmentMembershipScope(
    {
      role: "Admin School",
      sub: "user-uuid-1",
      schoolCode: LEFTOVER_A,
      effectiveSchoolCode: LOGIN_B,
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.enrollmentLoginCode, LOGIN_A);
  assert.notEqual(attached.enrollmentLoginCode, LOGIN_B);
});

test("ENR: Superadmin request-scoped résout leftover → login_code", async () => {
  const one = async (sql, params) => {
    assert.match(String(sql), /FROM schools/i);
    assert.doesNotMatch(String(sql), /\sOR\s/i);
    assert.doesNotMatch(String(sql), /coalesce/i);
    assert.equal(params[0], LEFTOVER_A);
    if (/school_code/.test(String(sql))) {
      return { id: SCHOOL_ID_A, login_code: LOGIN_A };
    }
    return null;
  };
  const attached = await attachEnrollmentMembershipScope(
    {
      role: "Super Administrateur Somafrik",
      schoolCode: "",
      effectiveSchoolCode: LEFTOVER_A,
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.enrollmentLoginCode, LOGIN_A);
  assert.equal(attached.enrollmentSchoolId, SCHOOL_ID_A);
});

test("ENR: GET élèves exige un login_code membership", () => {
  assert.equal(
    assertEnrollmentSchoolCode({
      role: "Admin School",
      schoolCode: LEFTOVER_A,
      enrollmentLoginCode: LOGIN_A,
      enrollmentSchoolId: SCHOOL_ID_A,
    }),
    LOGIN_A,
  );
  assert.throws(
    () =>
      assertEnrollmentSchoolCode({
        role: "Admin School",
        schoolCode: LEFTOVER_A,
      }),
    (error) => error.statusCode === 403,
  );
  assert.throws(
    () =>
      assertEnrollmentSchoolCode({
        role: "Super Administrateur Somafrik",
        schoolCode: "*",
      }),
    (error) => error.statusCode === 400,
  );
});

test("ENR: PATCH compare school_id / login_code, pas leftover JWT", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    enrollmentLoginCode: LOGIN_A,
    enrollmentSchoolId: SCHOOL_ID_A,
  };
  assert.doesNotThrow(() =>
    assertEnrollmentStudentAccess(principal, { schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A }),
  );
  assert.throws(
    () => assertEnrollmentStudentAccess(principal, { schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B }),
    (error) => error.statusCode === 403,
  );
});

test("ENR: POST body B depuis membership A est un mismatch", async () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    enrollmentLoginCode: LOGIN_A,
    enrollmentSchoolId: SCHOOL_ID_A,
    sub: "user-a",
  };
  const one = async (sql, params) => {
    if (/SELECT school_code/.test(String(sql))) {
      assert.equal(params[0], SCHOOL_ID_A);
      return { school_code: LEFTOVER_A };
    }
    if (/login_code/.test(String(sql))) {
      return { id: SCHOOL_ID_B };
    }
    return null;
  };
  await assert.rejects(
    () => resolveEnrollmentWriteSchool(principal, { schoolCode: LOGIN_B }, one),
    (error) => error.statusCode === 403,
  );
  const omitted = await resolveEnrollmentWriteSchool(principal, {}, one);
  assert.equal(omitted.schoolId, SCHOOL_ID_A);
  assert.equal(omitted.loginCode, LOGIN_A);
});

test("ENR: findSchoolForPlatformScope n'émet que login_code", async () => {
  const leftoverLookups = [];
  const one = async (sql, params) => {
    leftoverLookups.push(String(sql));
    assert.doesNotMatch(String(sql), /\sOR\s/i);
    assert.doesNotMatch(String(sql), /coalesce/i);
    assert.equal(params[0], LEFTOVER_A);
    if (/school_code/.test(String(sql))) return { id: SCHOOL_ID_A, login_code: LOGIN_A };
    return null;
  };
  const found = await findSchoolForPlatformScope(LEFTOVER_A, one);
  assert.equal(found.loginCode, LOGIN_A);
  assert.equal(found.schoolId, SCHOOL_ID_A);
  assert.equal(leftoverLookups.length, 2);
});

test("ENR: projection n'émet jamais leftover school_code", () => {
  assert.equal(publicSchoolCodeFromRow({ school_login_code: LOGIN_A, school_code: LEFTOVER_A }), LOGIN_A);
  assert.equal(publicSchoolCodeFromRow({ school_code: LEFTOVER_A }), "");
  assert.equal(projectEnrollmentApiStudent({ schoolCode: LEFTOVER_A }, LOGIN_A).schoolCode, LOGIN_A);
});

test("ENR: fixture mémoire n'utilise pas leftover comme autorité PG", () => {
  const attached = attachEnrollmentFixtureScope({
    role: "Admin School",
    schoolCode: "SCH-001",
  });
  assert.equal(attached.enrollmentLoginCode, "SCH-001");
  assert.equal(resolveEnrollmentSchoolScope(attached).mode, "school");
});
