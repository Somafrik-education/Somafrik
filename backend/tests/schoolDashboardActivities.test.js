"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { listSchoolDashboardActivities, resolveSchoolDashboardPrincipal } = require("../lib/schoolDashboardActivities");

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

test("resolves school UUID from verified school JWT when no X-Somafrik-School-Code header is sent", async () => {
  const jwt = { role: "Admin School", schoolCode: "CD-IN-26-001" };
  const lookup = async () => ({ id: schoolId, login_code: "CD-IN-26-001", school_code: "CD-2026-0001" });
  const resolved = await resolveSchoolDashboardPrincipal(jwt, lookup);
  assert.equal(resolved.effectiveSchoolId, schoolId);
  assert.equal(resolved.schoolCode, jwt.schoolCode);
  let queriedSchoolId;
  await listSchoolDashboardActivities({ all: async (_sql, params) => { queriedSchoolId = params[0]; return []; } }, resolved);
  assert.equal(queriedSchoolId, schoolId);
});

test("rejects missing or mismatched school records without cross-tenant fallback", async () => {
  const jwt = { role: "Admin School", schoolCode: "CD-IN-26-001" };
  for (const school of [null, { id: schoolId, login_code: "CD-OTHER-26-001", school_code: "CD-2026-0002" }]) {
    const resolved = await resolveSchoolDashboardPrincipal(jwt, async () => school);
    await assert.rejects(listSchoolDashboardActivities({ all: async () => { throw Error("must not query"); } }, resolved), { statusCode: 403 });
  }
});

test("never resolves a platform or non-school role to an establishment", async () => {
  for (const role of ["Super Administrateur Somafrik", "Admin Pays", "Enseignant"]) {
    const jwt = { role, schoolCode: "CD-IN-26-001" };
    const resolved = await resolveSchoolDashboardPrincipal(jwt, async () => { throw Error("must not lookup"); });
    assert.deepEqual(resolved, jwt);
  }
});
