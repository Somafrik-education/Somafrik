"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachAcademicYearMembershipScope,
  attachAcademicYearFixtureScope,
  resolveAcademicYearSchoolScope,
  academicYearCacheKey,
  sqlAcademicYearScope,
  filterAcademicYearRows,
  assertAcademicYearReadable,
  assertAcademicYearPatchAccess,
  resolveAcademicYearWriteSchool,
  findSchoolForPlatformScope,
} = require("./academicYearSchoolScope");

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LOGIN_B = "BI-BUJ-26-001";
const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

test("GP-002: leftover JWT n'est plus l'autorité Academic Year", () => {
  const scope = resolveAcademicYearSchoolScope({
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    sub: "user-uuid",
  });
  assert.equal(scope.mode, "none");
});

test("GP-002: membership login_code + school_id sont l'autorité", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    academicYearLoginCode: LOGIN_A,
    academicYearSchoolId: SCHOOL_ID_A,
    sub: "user-uuid",
  };
  const scope = resolveAcademicYearSchoolScope(principal);
  assert.equal(scope.mode, "school");
  assert.equal(scope.loginCode, LOGIN_A);
  assert.equal(scope.schoolId, SCHOOL_ID_A);
  const rows = [
    { id: "ay-a", schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A },
    { id: "ay-b", schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B },
  ];
  assert.deepEqual(
    filterAcademicYearRows(rows, scope).map((row) => row.id),
    ["ay-a"],
  );
});

test("GP-002: Superadmin global reste global", () => {
  const scope = resolveAcademicYearSchoolScope({
    role: "Super Administrateur Somafrik",
    schoolCode: "",
  });
  assert.equal(scope.mode, "all");
  assert.equal(filterAcademicYearRows([{ schoolCode: LOGIN_B }], scope).length, 1);
});

test("GP-002: Admin Pays global = pays, jamais leftover schoolCode", () => {
  const scope = resolveAcademicYearSchoolScope({
    role: "Admin Pays",
    countryCode: "CD",
    schoolCode: LEFTOVER_A,
  });
  assert.equal(scope.mode, "country");
  assert.equal(scope.countryCode, "CD");
  assert.equal(
    filterAcademicYearRows([{ schoolCode: LOGIN_A, countryCode: "CD" }], scope).length,
    1,
  );
  assert.equal(
    filterAcademicYearRows([{ schoolCode: LOGIN_B, countryCode: "BI" }], scope).length,
    0,
  );
});

test("GP-002: attach lit users.school_id → login_code", async () => {
  const one = async (sql, params) => {
    assert.match(String(sql), /users u/i);
    assert.equal(params[0], "user-uuid-1");
    return { school_id: SCHOOL_ID_A, login_code: LOGIN_A };
  };
  const attached = await attachAcademicYearMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    one,
  );
  assert.equal(attached.academicYearLoginCode, LOGIN_A);
  assert.equal(attached.academicYearSchoolId, SCHOOL_ID_A);
  assert.equal(attached.schoolCode, LEFTOVER_A);
});

test("GP-002: attach sans sub fail-closed", async () => {
  const attached = await attachAcademicYearMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A },
    async () => {
      throw new Error("lookup interdit sans sub");
    },
  );
  assert.equal(attached.academicYearLoginCode, "");
  assert.equal(resolveAcademicYearSchoolScope(attached).mode, "none");
  assert.throws(() => assertAcademicYearReadable(attached), (error) => error.statusCode === 403);
});

test("GP-002: attach sans one fail-closed (leftover ignoré)", async () => {
  const attached = await attachAcademicYearMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    null,
  );
  assert.equal(attached.academicYearLoginCode, "");
  assert.equal(resolveAcademicYearSchoolScope(attached).mode, "none");
});

test("GP-002: user sans school_id fail-closed", async () => {
  const attached = await attachAcademicYearMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    async () => null,
  );
  assert.equal(attached.academicYearLoginCode, "");
  assert.equal(attached.academicYearSchoolId, "");
  assert.equal(resolveAcademicYearSchoolScope(attached).mode, "none");
});

test("GP-002: login_code vide ne promeut pas leftover", async () => {
  const attached = await attachAcademicYearMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    async () => ({ school_id: SCHOOL_ID_A, login_code: "   " }),
  );
  assert.equal(attached.academicYearLoginCode, "");
  assert.notEqual(attached.academicYearLoginCode, LEFTOVER_A);
  assert.equal(resolveAcademicYearSchoolScope(attached).mode, "none");
});

test("GP-002: rôle établissement request-scoped reste membership UUID", async () => {
  const one = async (sql) => {
    if (/FROM users u/i.test(String(sql))) {
      return { school_id: SCHOOL_ID_A, login_code: LOGIN_A };
    }
    throw new Error("FIND request-scoped interdit pour un rôle établissement");
  };
  const attached = await attachAcademicYearMembershipScope(
    {
      role: "Admin School",
      sub: "user-uuid-1",
      schoolCode: LEFTOVER_A,
      effectiveSchoolCode: LOGIN_B,
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.academicYearLoginCode, LOGIN_A);
  assert.notEqual(attached.academicYearLoginCode, LOGIN_B);
});

test("GP-002: Superadmin request-scoped résout leftover → login_code", async () => {
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
  const attached = await attachAcademicYearMembershipScope(
    {
      role: "Super Administrateur Somafrik",
      schoolCode: "",
      effectiveSchoolCode: LEFTOVER_A,
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.academicYearLoginCode, LOGIN_A);
  assert.equal(attached.academicYearSchoolId, SCHOOL_ID_A);
});

test("GP-002: sqlAcademicYearScope cible school_id UUID, pas leftover", () => {
  const params = [];
  const pred = sqlAcademicYearScope({ mode: "school", schoolId: SCHOOL_ID_A, loginCode: LOGIN_A }, params);
  assert.match(pred, /ay\.school_id/);
  assert.doesNotMatch(pred, /school_code/);
  assert.doesNotMatch(pred, /login_code/);
  assert.doesNotMatch(pred, /coalesce/i);
  assert.deepEqual(params, [SCHOOL_ID_A]);
});

test("GP-002: cache key A/B ne se partagent pas", () => {
  const keyA = academicYearCacheKey({ mode: "school", schoolId: SCHOOL_ID_A, loginCode: LOGIN_A });
  const keyB = academicYearCacheKey({ mode: "school", schoolId: SCHOOL_ID_B, loginCode: LOGIN_B });
  assert.notEqual(keyA, keyB);
  assert.equal(academicYearCacheKey({ mode: "all" }), "v2:academic-years");
});

test("GP-002: PATCH compare school_id, pas leftover JWT", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    academicYearLoginCode: LOGIN_A,
    academicYearSchoolId: SCHOOL_ID_A,
  };
  assert.doesNotThrow(() =>
    assertAcademicYearPatchAccess(principal, { schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A }),
  );
  assert.throws(
    () => assertAcademicYearPatchAccess(principal, { schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B }),
    (error) => error.statusCode === 403,
  );
});

test("GP-002: POST body B depuis membership A est un mismatch", async () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    academicYearLoginCode: LOGIN_A,
    academicYearSchoolId: SCHOOL_ID_A,
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
    () => resolveAcademicYearWriteSchool(principal, { schoolCode: LOGIN_B }, one),
    (error) => error.statusCode === 403,
  );
  const omitted = await resolveAcademicYearWriteSchool(principal, {}, one);
  assert.equal(omitted.schoolId, SCHOOL_ID_A);
  assert.equal(omitted.loginCode, LOGIN_A);
  const leftoverBody = await resolveAcademicYearWriteSchool(principal, { schoolCode: LEFTOVER_A }, one);
  assert.equal(leftoverBody.schoolId, SCHOOL_ID_A, "leftover A dans le body n'est pas l'autorité");
});

test("GP-002: findSchoolForPlatformScope n'émet que login_code", async () => {
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
  assert.equal(await findSchoolForPlatformScope(LEFTOVER_A, async () => ({ id: SCHOOL_ID_A, login_code: null })), null);
});

test("GP-002: fixture mémoire n'utilise pas leftover comme autorité PG", () => {
  const attached = attachAcademicYearFixtureScope({
    role: "Admin School",
    schoolCode: "SCH-001",
  });
  assert.equal(attached.academicYearLoginCode, "SCH-001");
  assert.equal(resolveAcademicYearSchoolScope(attached).mode, "school");
});
