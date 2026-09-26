"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { listSchoolDashboardActivities } = require("../lib/schoolDashboardActivities");

const schoolId = "11111111-1111-4111-8111-111111111111";
const foreignSchoolId = "22222222-2222-4222-8222-222222222222";
const principal = { role: "Admin School", effectiveSchoolId: schoolId };
const event = (id, at, action = "create_class") => ({ id, created_at: at, action });

test("school dashboard feed rejects platform, staff and missing or invalid tenant identity", async () => {
  let queries = 0;
  const repository = { all: async () => { queries++; return []; } };
  for (const role of ["Super Administrateur Somafrik", "Admin Pays", "Enseignant", "Secrétaire", "Parent"]) {
    await assert.rejects(listSchoolDashboardActivities(repository, { ...principal, role }), { statusCode: 403 });
  }
  for (const identity of [undefined, "", "CD-IN-26-001", foreignSchoolId.slice(0, 20)]) {
    await assert.rejects(listSchoolDashboardActivities(repository, { ...principal, effectiveSchoolId: identity }), { statusCode: 403 });
  }
  assert.equal(queries, 0);
});

test("school dashboard feed is tenant-scoped, allowlisted and redacts audit payloads", async () => {
  let sql, params;
  const repository = { all: async (query, args) => {
    sql = query;
    params = args;
    return [{ ...event("33333333-3333-4333-8333-333333333333", "2026-09-26T12:00:00Z"), ip_address: "private", new_value: { secret: true } }];
  } };
  const page = await listSchoolDashboardActivities(repository, principal, { limit: "10" });
  assert.equal(params[0], schoolId);
  assert.deepEqual(params[1], ["create_class", "update_class", "enroll_student"]);
  assert.match(sql, /a\.school_id = \$1::uuid/);
  assert.match(sql, /a\.action = ANY\(\$2::text\[\]\)/);
  assert.doesNotMatch(sql, /new_value|old_value|ip_address|user_agent/);
  assert.deepEqual(page.items, [{ id: "33333333-3333-4333-8333-333333333333", label: "Classe créée", at: "2026-09-26T12:00:00Z" }]);
  assert.equal(page.nextCursor, null);
});

test("pagination caps limit, uses strict cursor, and remains scoped to the same tenant", async () => {
  const ids = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
  const at = "2026-09-26T12:00:00Z";
  const calls = [];
  const repository = { all: async (sql, params) => {
    calls.push({ sql, params });
    return calls.length === 1 ? [event(ids[0], at), event(ids[1], at)] : [];
  } };
  const first = await listSchoolDashboardActivities(repository, principal, { limit: "1" });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  assert.equal(calls[0].params[2], 2);
  await listSchoolDashboardActivities(repository, principal, { limit: "999", cursor: first.nextCursor });
  assert.equal(calls[1].params[0], schoolId);
  assert.equal(calls[1].params[2], 31);
  assert.match(calls[1].sql, /\(a\.created_at, a\.id\) < \(\$4::timestamptz, \$5::uuid\)/);
  assert.equal(calls[1].params[4], ids[0]);
});

test("malformed cursor fails before SQL execution", async () => {
  let queries = 0;
  const repository = { all: async () => { queries++; return []; } };
  for (const cursor of ["invalid", Buffer.from(JSON.stringify({ at: "not-a-date", id: "invalid" })).toString("base64url")]) {
    await assert.rejects(listSchoolDashboardActivities(repository, principal, { cursor }), { statusCode: 400 });
  }
  assert.equal(queries, 0);
});
