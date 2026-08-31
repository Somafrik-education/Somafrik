"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachUsersMembershipScope,
  attachUsersFixtureScope,
  attachUsersMemoryMembership,
  resolveUsersSchoolScope,
  sqlUsersScope,
  filterUsersRows,
  assertUsersReadable,
  assertUsersTargetAccess,
  resolveUsersWriteSchool,
  findSchoolForPlatformScope,
  projectUsersApiUser,
} = require("./usersSchoolScope");

const LEFTOVER_A = "CD-2026-0001";
const LOGIN_A = "CD-LAC-26-001";
const LEFTOVER_B = "BI-2026-0001";
const LOGIN_B = "BI-BUJ-26-001";
const SCHOOL_ID_A = "11111111-1111-4111-8111-111111111111";
const SCHOOL_ID_B = "22222222-2222-4222-8222-222222222222";

test("GP-003: leftover JWT n'est plus l'autorité Users", () => {
  const scope = resolveUsersSchoolScope({
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    sub: "user-uuid",
  });
  assert.equal(scope.mode, "none");
});

test("GP-003: membership login_code + school_id sont l'autorité", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    usersLoginCode: LOGIN_A,
    usersSchoolId: SCHOOL_ID_A,
    sub: "user-uuid",
  };
  const scope = resolveUsersSchoolScope(principal);
  assert.equal(scope.mode, "school");
  assert.equal(scope.loginCode, LOGIN_A);
  assert.equal(scope.schoolId, SCHOOL_ID_A);
  const rows = [
    { id: "u-a", schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A, schoolPublicCode: LOGIN_A },
    { id: "u-b", schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B, schoolPublicCode: LOGIN_B },
  ];
  assert.deepEqual(
    filterUsersRows(rows, scope).map((row) => row.id),
    ["u-a"],
  );
});

test("GP-003: Superadmin global reste global", () => {
  const scope = resolveUsersSchoolScope({
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
  });
  assert.equal(scope.mode, "all");
});

test("GP-003: Admin Pays global = pays, jamais leftover schoolCode", () => {
  const scope = resolveUsersSchoolScope({
    role: "Admin Pays",
    countryCode: "CD",
    schoolCode: LEFTOVER_A,
  });
  assert.equal(scope.mode, "country");
  assert.equal(scope.countryCode, "CD");
});

test("GP-003: attach lit users.school_id → login_code", async () => {
  const one = async (sql, params) => {
    assert.match(String(sql), /FROM users u/i);
    assert.equal(params[0], "user-a");
    return { school_id: SCHOOL_ID_A, login_code: LOGIN_A };
  };
  const attached = await attachUsersMembershipScope(
    { role: "Admin School", sub: "user-a", schoolCode: LEFTOVER_A },
    one,
  );
  assert.equal(attached.usersLoginCode, LOGIN_A);
  assert.equal(attached.usersSchoolId, SCHOOL_ID_A);
});

test("GP-003: attach sans sub fail-closed", async () => {
  const attached = await attachUsersMembershipScope(
    { role: "Admin School", schoolCode: LEFTOVER_A },
    async () => ({ school_id: SCHOOL_ID_A, login_code: LOGIN_A }),
  );
  assert.equal(attached.usersLoginCode, "");
  assert.equal(resolveUsersSchoolScope(attached).mode, "none");
});

test("GP-003: attach sans one fail-closed (leftover ignoré)", async () => {
  const attached = await attachUsersMembershipScope(
    { role: "Admin School", sub: "user-a", schoolCode: LEFTOVER_A },
    null,
  );
  assert.equal(attached.usersLoginCode, "");
});

test("GP-003: user sans school_id fail-closed", async () => {
  const attached = await attachUsersMembershipScope(
    { role: "Admin School", sub: "user-a", schoolCode: LEFTOVER_A },
    async () => null,
  );
  assert.equal(attached.usersLoginCode, "");
  assert.equal(resolveUsersSchoolScope(attached).mode, "none");
});

test("GP-003: login_code vide ne promeut pas leftover", async () => {
  const attached = await attachUsersMembershipScope(
    { role: "Admin School", sub: "user-a", schoolCode: LEFTOVER_A },
    async () => ({ school_id: SCHOOL_ID_A, login_code: "  " }),
  );
  assert.equal(attached.usersLoginCode, "");
  assert.equal(resolveUsersSchoolScope(attached).mode, "none");
});

test("GP-003: rôle établissement request-scoped reste membership UUID", async () => {
  const one = async () => ({ school_id: SCHOOL_ID_A, login_code: LOGIN_A });
  const attached = await attachUsersMembershipScope(
    {
      role: "Admin School",
      sub: "user-uuid-1",
      schoolCode: LEFTOVER_A,
      effectiveSchoolCode: LOGIN_B,
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.usersLoginCode, LOGIN_A);
  assert.notEqual(attached.usersLoginCode, LOGIN_B);
});

test("GP-003: Superadmin request-scoped résout leftover → login_code", async () => {
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
  const attached = await attachUsersMembershipScope(
    {
      role: "Super Administrateur Somafrik",
      schoolCode: "",
      effectiveSchoolCode: LEFTOVER_A,
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.usersLoginCode, LOGIN_A);
  assert.equal(attached.usersSchoolId, SCHOOL_ID_A);
});

test("GP-003: sqlUsersScope cible school_id UUID, pas leftover", () => {
  const params = [];
  const pred = sqlUsersScope({ mode: "school", schoolId: SCHOOL_ID_A, loginCode: LOGIN_A }, params);
  assert.match(pred, /u\.school_id/);
  assert.doesNotMatch(pred, /school_code/);
  assert.doesNotMatch(pred, /login_code/);
  assert.doesNotMatch(pred, /coalesce/i);
  assert.deepEqual(params, [SCHOOL_ID_A]);
});

test("GP-003: sqlUsersScope country inclut schoolless du pays, jamais l'autre pays", () => {
  const params = [];
  const pred = sqlUsersScope({ mode: "country", countryCode: "CD" }, params);
  assert.match(pred, /school_id IS NULL/);
  assert.match(pred, /profile_payload->>'countryCode'/);
  assert.doesNotMatch(pred, /school_code/);
  assert.doesNotMatch(pred, /jwt/i);
  assert.deepEqual(params, ["CD"]);
  const rows = [
    { id: "pays-cd", schoolId: "", countryCode: "CD" },
    { id: "pays-bi", schoolId: "", countryCode: "BI" },
    { id: "staff-cd", schoolId: SCHOOL_ID_A, countryCode: "CD" },
  ];
  assert.deepEqual(
    filterUsersRows(rows, { mode: "country", countryCode: "CD" }).map((row) => row.id),
    ["pays-cd", "staff-cd"],
  );
});

test("GP-003: schoolId UUID membership A accepté ; UUID B refusé", async () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    usersLoginCode: LOGIN_A,
    usersSchoolId: SCHOOL_ID_A,
    sub: "user-a",
  };
  const one = async () => {
    throw new Error("schoolId membership ne doit pas lancer de lookup code");
  };
  const same = await resolveUsersWriteSchool(principal, { schoolId: SCHOOL_ID_A }, one);
  assert.equal(same.schoolId, SCHOOL_ID_A);
  assert.equal(same.loginCode, LOGIN_A);
  const cased = await resolveUsersWriteSchool(principal, { schoolId: SCHOOL_ID_A.toUpperCase() }, one);
  assert.equal(cased.schoolId, SCHOOL_ID_A);
  await assert.rejects(
    () => resolveUsersWriteSchool(principal, { schoolId: SCHOOL_ID_B }, async () => null),
    (error) => error.statusCode === 403,
  );
});

test("GP-003: PATCH/grant compare school_id, pas leftover JWT", () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    usersLoginCode: LOGIN_A,
    usersSchoolId: SCHOOL_ID_A,
  };
  assert.doesNotThrow(() =>
    assertUsersTargetAccess(principal, { schoolId: SCHOOL_ID_A, schoolCode: LOGIN_A }),
  );
  assert.throws(
    () => assertUsersTargetAccess(principal, { schoolId: SCHOOL_ID_B, schoolCode: LOGIN_B }),
    (error) => error.statusCode === 403,
  );
});

test("GP-003: POST body B depuis membership A est un mismatch", async () => {
  const principal = {
    role: "Admin School",
    schoolCode: LEFTOVER_A,
    usersLoginCode: LOGIN_A,
    usersSchoolId: SCHOOL_ID_A,
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
    () => resolveUsersWriteSchool(principal, { schoolCode: LOGIN_B }, one),
    (error) => error.statusCode === 403,
  );
  const omitted = await resolveUsersWriteSchool(principal, {}, one);
  assert.equal(omitted.schoolId, SCHOOL_ID_A);
  assert.equal(omitted.loginCode, LOGIN_A);
  const leftoverBody = await resolveUsersWriteSchool(principal, { schoolCode: LEFTOVER_A }, one);
  assert.equal(leftoverBody.schoolId, SCHOOL_ID_A, "leftover A dans le body n'est pas l'autorité");
});

test("GP-003: findSchoolForPlatformScope n'émet que login_code", async () => {
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

test("GP-003: Admin Pays mémoire refuse schoolCode hors pays", async () => {
  const principal = {
    role: "Admin Pays",
    countryCode: "CD",
  };
  await assert.rejects(
    () => resolveUsersWriteSchool(principal, { schoolCode: LOGIN_B }, null),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    () => resolveUsersWriteSchool(principal, { schoolCode: LEFTOVER_B }, null),
    (error) => error.statusCode === 403,
  );
  const allowed = await resolveUsersWriteSchool(principal, { schoolCode: LOGIN_A }, null);
  assert.equal(allowed.loginCode, LOGIN_A);
});

test("GP-003: fixture mémoire n'utilise pas leftover comme autorité PG", () => {
  const attached = attachUsersFixtureScope({
    role: "Admin School",
    schoolCode: "SCH-001",
  });
  assert.equal(attached.usersLoginCode, "SCH-001");
  assert.equal(resolveUsersSchoolScope(attached).mode, "school");
});

test("GP-003: mémoire HTTP résout login_code depuis membership, pas leftover JWT", async () => {
  const store = {
    _tables: {
      userRoles: [{ user_id: "admin-cd", school_id: SCHOOL_ID_A, status: "active", revoked_at: null }],
      schools: [{ id: SCHOOL_ID_A, code: LEFTOVER_A, loginCode: LOGIN_A }],
    },
    async getUserById() {
      return null;
    },
    async getSchoolById(id) {
      assert.equal(id, SCHOOL_ID_A);
      return { id: SCHOOL_ID_A, login_code: LOGIN_A, school_code: LEFTOVER_A };
    },
  };
  const attached = await attachUsersMemoryMembership(
    { role: "Admin School", sub: "admin-cd", schoolCode: LEFTOVER_A },
    store,
  );
  assert.equal(attached.usersLoginCode, LOGIN_A);
  assert.equal(attached.usersSchoolId, SCHOOL_ID_A);
  assert.notEqual(attached.usersLoginCode, LEFTOVER_A);
});

test("GP-003: projection API émet login_code, pas leftover", () => {
  const projected = projectUsersApiUser({
    id: "u1",
    schoolCode: LEFTOVER_A,
    schoolPublicCode: LOGIN_A,
    schoolId: SCHOOL_ID_A,
  });
  assert.equal(projected.schoolCode, LOGIN_A);
  assert.notEqual(projected.schoolCode, LEFTOVER_A);
});

test("GP-003: assertUsersReadable fail-closed sans membership", () => {
  assert.throws(
    () => assertUsersReadable({ role: "Admin School", schoolCode: LEFTOVER_A, sub: "x" }),
    (error) => error.statusCode === 403,
  );
});
