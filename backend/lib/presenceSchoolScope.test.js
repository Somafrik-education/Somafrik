"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachPresenceMembershipScope,
  attachPresenceFixtureScope,
  resolvePresenceSchoolScope,
  sqlPresenceScope,
  filterPresenceRows,
  assertPresenceReadable,
  assertPresenceWriteAccess,
  hasPresenceMembershipAttached,
} = require("./presenceSchoolScope");

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

test("GP-015: leftover JWT n'est plus l'autorité Présences", () => {
  const scope = resolvePresenceSchoolScope({
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    sub: "user-uuid",
  });
  assert.equal(scope.mode, "none");
});

test("GP-015: membership login_code + school_id sont l'autorité", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    presenceLoginCode: LOGIN_A,
    presenceSchoolId: SCHOOL_ID_A,
    sub: "user-uuid",
  };
  const scope = resolvePresenceSchoolScope(principal);
  assert.equal(scope.mode, "school");
  assert.equal(scope.loginCode, LOGIN_A);
  assert.equal(scope.schoolId, SCHOOL_ID_A);
  const rows = [
    { id: "pre-a", schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A },
    { id: "pre-b", schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B },
  ];
  assert.deepEqual(
    filterPresenceRows(rows, scope).map((row) => row.id),
    ["pre-a"],
  );
});

test("GP-015: Superadmin global reste global", () => {
  const scope = resolvePresenceSchoolScope({
    role: "Super Administrateur Somafrik",
    schoolCode: "",
  });
  assert.equal(scope.mode, "all");
  assert.equal(filterPresenceRows([{ schoolCode: LOGIN_B }], scope).length, 1);
});

test("GP-015: Admin Pays global = pays, jamais leftover schoolCode", () => {
  const scope = resolvePresenceSchoolScope({
    role: "Admin Pays",
    countryCode: "CD",
    schoolCode: LEFTOVER_A,
  });
  assert.equal(scope.mode, "country");
  assert.equal(
    filterPresenceRows([{ schoolCode: LOGIN_A, countryCode: "CD" }], scope).length,
    1,
  );
  assert.equal(
    filterPresenceRows([{ schoolCode: LOGIN_B, countryCode: "BI" }], scope).length,
    0,
  );
});

test("GP-015: attach lit users.school_id → login_code", async () => {
  const one = async (sql, params) => {
    assert.match(String(sql), /users u/i);
    assert.equal(params[0], "user-uuid-1");
    return { school_id: SCHOOL_ID_A, login_code: LOGIN_A };
  };
  const attached = await attachPresenceMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    one,
  );
  assert.equal(attached.presenceLoginCode, LOGIN_A);
  assert.equal(attached.presenceSchoolId, SCHOOL_ID_A);
  assert.equal(attached.schoolCode, LEFTOVER_A);
  assert.equal(hasPresenceMembershipAttached(attached), true);
});

test("GP-015: attach sans sub fail-closed", async () => {
  const attached = await attachPresenceMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A },
    async () => {
      throw new Error("lookup interdit sans sub");
    },
  );
  assert.equal(attached.presenceLoginCode, "");
  assert.equal(resolvePresenceSchoolScope(attached).mode, "none");
  assert.throws(() => assertPresenceReadable(attached), (error) => error.statusCode === 403);
});

test("GP-015: user sans school_id fail-closed", async () => {
  const attached = await attachPresenceMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    async () => null,
  );
  assert.equal(resolvePresenceSchoolScope(attached).mode, "none");
});

test("GP-015: login_code vide ne promeut pas leftover", async () => {
  const attached = await attachPresenceMembershipScope(
    { role: "Admin School", sub: "user-uuid-1", schoolCode: LEFTOVER_A },
    async () => ({ school_id: SCHOOL_ID_A, login_code: "   " }),
  );
  assert.notEqual(attached.presenceLoginCode, LEFTOVER_A);
  assert.equal(resolvePresenceSchoolScope(attached).mode, "none");
});

test("GP-015: sqlPresenceScope cible school_id UUID, pas leftover", () => {
  const params = [];
  const pred = sqlPresenceScope({ mode: "school", schoolId: SCHOOL_ID_A, loginCode: LOGIN_A }, params);
  assert.match(pred, /a\.school_id/);
  assert.doesNotMatch(pred, /school_code/);
  assert.doesNotMatch(pred, /login_code/);
  assert.doesNotMatch(pred, /coalesce/i);
  assert.deepEqual(params, [SCHOOL_ID_A]);
});

test("GP-015: write compare school_id, pas leftover JWT", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    presenceLoginCode: LOGIN_A,
    presenceSchoolId: SCHOOL_ID_A,
  };
  assert.doesNotThrow(() =>
    assertPresenceWriteAccess(principal, { schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A }),
  );
  assert.throws(
    () => assertPresenceWriteAccess(principal, { schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B }),
    (error) => error.statusCode === 403,
  );
});

test("GP-015: fixture mémoire n'est pas un lookup leftover PG", () => {
  const attached = attachPresenceFixtureScope({
    role: "Admin School",
    schoolCode: LOGIN_A,
  });
  assert.equal(attached.presenceLoginCode, LOGIN_A);
});
