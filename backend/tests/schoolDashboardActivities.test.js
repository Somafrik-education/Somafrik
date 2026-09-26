"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { listSchoolDashboardActivities } = require("../lib/schoolDashboardActivities");

const schoolId = "11111111-1111-4111-8111-111111111111";
const principal = { role: "Admin School", effectiveSchoolId: schoolId };

test("denies platform and non-admin school roles before querying", async () => {
  let called = false;
  const repository = { all: async () => { called = true; return []; } };
  for (const role of ["Super Administrateur Somafrik", "Admin Pays", "Enseignant", "Secrétaire"]) {
    await assert.rejects(listSchoolDashboardActivities(repository, { ...principal, role }), { statusCode: 403 });
  }
  await assert.rejects(listSchoolDashboardActivities(repository, { role: "Admin School" }), { statusCode: 403 });
  assert.equal(called, false);
});

test("only selects safe fields and scopes by school UUID", async () => {
  let sql, params;
  const repository = { all: async (query, args) => { sql = query; params = args; return [{ id: "22222222-2222-4222-8222-222222222222", action: "create_class", created_at: "2026-09-26T12:00:00Z" }]; } };
  const page = await listSchoolDashboardActivities(repository, principal);
  assert.equal(params[0], schoolId);
  assert.match(sql, /a.school_id = \$1::uuid/);
  assert.doesNotMatch(sql, /new_value|old_value|ip_address|user_agent/);
  assert.deepEqual(page.items[0], { id: "22222222-2222-4222-8222-222222222222", label: "Classe créée", at: "2026-09-26T12:00:00Z" });
});

test("rejects malformed pagination cursor", async () => {
  await assert.rejects(listSchoolDashboardActivities({ all: async () => [] }, principal, { cursor: "invalid" }), { statusCode: 400 });
});
