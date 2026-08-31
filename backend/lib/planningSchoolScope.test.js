"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachPlanningMembershipScope,
  attachPlanningFixtureScope,
  resolvePlanningSchoolScope,
  sqlPlanningScope,
  filterPlanningRows,
  assertPlanningReadable,
  assertPlanningPatchAccess,
  hasPlanningMembershipAttached,
} = require("./planningSchoolScope");

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

test("GP-014: leftover JWT n'est plus l'autorité Planning", () => {
  const scope = resolvePlanningSchoolScope({
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    sub: "user-uuid",
  });
  assert.equal(scope.mode, "none");
});

test("GP-014: membership login_code + school_id sont l'autorité", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    planningLoginCode: LOGIN_A,
    planningSchoolId: SCHOOL_ID_A,
    sub: "user-uuid",
  };
  const scope = resolvePlanningSchoolScope(principal);
  assert.equal(scope.mode, "school");
  assert.equal(scope.loginCode, LOGIN_A);
  assert.equal(scope.schoolId, SCHOOL_ID_A);
  const rows = [
    { id: "slot-a", schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A },
    { id: "slot-b", schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B },
  ];
  assert.deepEqual(
    filterPlanningRows(rows, scope).map((row) => row.id),
    ["slot-a"],
  );
});

test("GP-014: Superadmin global reste global", () => {
  const scope = resolvePlanningSchoolScope({
    role: "Super Administrateur Somafrik",
    schoolCode: "",
  });
  assert.equal(scope.mode, "all");
  assert.equal(filterPlanningRows([{ schoolCode: LOGIN_B }], scope).length, 1);
});

test("GP-014: Admin Pays global = pays, jamais leftover schoolCode", () => {
  const scope = resolvePlanningSchoolScope({
    role: "Admin Pays",
    countryCode: "CD",
    schoolCode: LEFTOVER_A,
  });
  assert.equal(scope.mode, "country");
  assert.equal(scope.countryCode, "CD");
  assert.equal(
    filterPlanningRows([{ schoolCode: LOGIN_A, countryCode: "CD" }], scope).length,
    1,
  );
  assert.equal(
    filterPlanningRows([{ schoolCode: LOGIN_B, countryCode: "BI" }], scope).length,
    0,
  );
});

test("GP-014: attach lit users.school_id → login_code", async () => {
  const one = async (sql, params) => {
    assert.match(String(sql), /users u/i);
    assert.equal(params[0], "user-uuid-1");
    return { school_id: SCHOOL_ID_A, login_code: LOGIN_A };
  };
  const attached = await attachPlanningMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    one,
  );
  assert.equal(attached.planningLoginCode, LOGIN_A);
  assert.equal(attached.planningSchoolId, SCHOOL_ID_A);
  assert.equal(attached.schoolCode, LEFTOVER_A);
  assert.equal(hasPlanningMembershipAttached(attached), true);
});

test("GP-014: attach sans sub fail-closed", async () => {
  const attached = await attachPlanningMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A },
    async () => {
      throw new Error("lookup interdit sans sub");
    },
  );
  assert.equal(attached.planningLoginCode, "");
  assert.equal(resolvePlanningSchoolScope(attached).mode, "none");
  assert.throws(() => assertPlanningReadable(attached), (error) => error.statusCode === 403);
});

test("GP-014: attach sans one fail-closed (leftover ignoré)", async () => {
  const attached = await attachPlanningMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    null,
  );
  assert.equal(attached.planningLoginCode, "");
  assert.equal(resolvePlanningSchoolScope(attached).mode, "none");
});

test("GP-014: user sans school_id fail-closed", async () => {
  const attached = await attachPlanningMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    async () => null,
  );
  assert.equal(attached.planningLoginCode, "");
  assert.equal(attached.planningSchoolId, "");
  assert.equal(resolvePlanningSchoolScope(attached).mode, "none");
});

test("GP-014: login_code vide ne promeut pas leftover", async () => {
  const attached = await attachPlanningMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    async () => ({ school_id: SCHOOL_ID_A, login_code: "   " }),
  );
  assert.equal(attached.planningLoginCode, "");
  assert.notEqual(attached.planningLoginCode, LEFTOVER_A);
  assert.equal(resolvePlanningSchoolScope(attached).mode, "none");
});

test("GP-014: rôle établissement request-scoped reste membership UUID", async () => {
  const one = async (sql) => {
    if (/FROM users u/i.test(String(sql))) {
      return { school_id: SCHOOL_ID_A, login_code: LOGIN_A };
    }
    throw new Error("FIND request-scoped interdit pour un rôle établissement");
  };
  const attached = await attachPlanningMembershipScope(
    {
      role: "Admin School",
      sub: "user-uuid-1",
      schoolCode: LEFTOVER_A,
      effectiveSchoolCode: LOGIN_B,
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.planningLoginCode, LOGIN_A);
  assert.notEqual(attached.planningLoginCode, LOGIN_B);
});

test("GP-014: Superadmin request-scoped résout leftover → login_code", async () => {
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
  const attached = await attachPlanningMembershipScope(
    {
      role: "Super Administrateur Somafrik",
      schoolCode: "",
      effectiveSchoolCode: LEFTOVER_A,
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.planningLoginCode, LOGIN_A);
  assert.equal(attached.planningSchoolId, SCHOOL_ID_A);
});

test("GP-014: sqlPlanningScope cible school_id UUID, pas leftover", () => {
  const params = [];
  const pred = sqlPlanningScope({ mode: "school", schoolId: SCHOOL_ID_A, loginCode: LOGIN_A }, params);
  assert.match(pred, /w\.school_id/);
  assert.doesNotMatch(pred, /school_code/);
  assert.doesNotMatch(pred, /login_code/);
  assert.doesNotMatch(pred, /coalesce/i);
  assert.deepEqual(params, [SCHOOL_ID_A]);
});

test("GP-014: PATCH compare school_id, pas leftover JWT", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    planningLoginCode: LOGIN_A,
    planningSchoolId: SCHOOL_ID_A,
  };
  assert.doesNotThrow(() =>
    assertPlanningPatchAccess(principal, { schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A }),
  );
  assert.throws(
    () => assertPlanningPatchAccess(principal, { schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B }),
    (error) => error.statusCode === 403,
  );
});

test("GP-014: fixture mémoire n'est pas un lookup leftover PG", () => {
  const attached = attachPlanningFixtureScope({
    role: "Admin School",
    schoolCode: LOGIN_A,
  });
  assert.equal(attached.planningLoginCode, LOGIN_A);
});
