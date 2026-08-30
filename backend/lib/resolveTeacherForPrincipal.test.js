"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveTeacherIdForPrincipal } = require("./resolveTeacherForPrincipal");

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const SCHOOL_ID = "550e8400-e29b-41d4-a716-446655440002";
const TEACHER_ID = "550e8400-e29b-41d4-a716-446655440003";

test("principal.sub UUID user → teacher UUID", async () => {
  const seen = [];
  const id = await resolveTeacherIdForPrincipal(
    async (sql, params) => {
      seen.push({ sql, params });
      return { id: TEACHER_ID };
    },
    { sub: USER_ID },
    SCHOOL_ID,
  );
  assert.equal(id, TEACHER_ID);
  assert.equal(seen[0].params[0], SCHOOL_ID);
  assert.equal(seen[0].params[1], USER_ID);
  assert.match(seen[0].sql, /t\.user_id = \$2::uuid/);
  assert.doesNotMatch(seen[0].sql, /teacher_code/);
});

test("principal.sub ENS-0001 → refus", async () => {
  let queried = false;
  const id = await resolveTeacherIdForPrincipal(
    async () => {
      queried = true;
      return { id: TEACHER_ID };
    },
    { sub: "ENS-0001" },
    SCHOOL_ID,
  );
  assert.equal(id, null);
  assert.equal(queried, false);
});

test("principal.sub code public → refus", async () => {
  let queried = false;
  const id = await resolveTeacherIdForPrincipal(
    async () => {
      queried = true;
      return { id: TEACHER_ID };
    },
    { sub: "CD-IN-JK-26-00001" },
    SCHOOL_ID,
  );
  assert.equal(id, null);
  assert.equal(queried, false);
});

test("principal.sub = users.user_code → refus", async () => {
  let queried = false;
  const id = await resolveTeacherIdForPrincipal(
    async () => {
      queried = true;
      return { id: TEACHER_ID };
    },
    { sub: "CD-IN-AL-26-00001" },
    SCHOOL_ID,
  );
  assert.equal(id, null);
  assert.equal(queried, false);
});

test("sub absent / school absent → refus", async () => {
  assert.equal(await resolveTeacherIdForPrincipal(async () => ({ id: TEACHER_ID }), {}, SCHOOL_ID), null);
  assert.equal(await resolveTeacherIdForPrincipal(async () => ({ id: TEACHER_ID }), { sub: USER_ID }, ""), null);
});
