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
  assert.doesNotMatch(sql, /old_value|ip_address|user_agent|student_name|studentName/);
  assert.match(sql, /new_value->>'dayOfWeek'/);
  assert.deepEqual(page.items[0], { id: "22222222-2222-4222-8222-222222222222", label: "Classe créée", at: "2026-09-26T12:00:00Z", detail: null });
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

test("uses the authenticated JWT school UUID when code lookup cannot resolve an internal alias", async () => {
  const jwt = { role: "Admin School", schoolCode: "SCH-A3A33AC861644EE5A967", schoolId };
  const resolved = await resolveSchoolDashboardPrincipal(jwt, async () => { throw Error("lookup should not be necessary"); });
  assert.equal(resolved.effectiveSchoolId, schoolId);
  let queriedSchoolId;
  await listSchoolDashboardActivities({ all: async (_sql, params) => { queriedSchoolId = params[0]; return []; } }, resolved);
  assert.equal(queriedSchoolId, schoolId);
});

test("ignores malformed JWT school UUID and fails closed if code lookup fails", async () => {
  const jwt = { role: "Admin School", schoolCode: "SCH-NOT-FOUND", schoolId: "not-a-uuid" };
  const resolved = await resolveSchoolDashboardPrincipal(jwt, async () => null);
  await assert.rejects(listSchoolDashboardActivities({ all: async () => { throw Error("must not query"); } }, resolved), { statusCode: 403 });
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


test("school activity feed allows audited attendance and planning events without exposing audit payload", async () => {
  let sql, params;
  const actions = ["upsert_attendance", "upsert_attendance_batch", "create_course_schedule", "update_course_schedule", "cancel_course_schedule", "create_payment"];
  const repository = { all: async (query, args) => {
    sql = query;
    params = args;
    return actions.map((action, index) => ({ id: `22222222-2222-4222-8222-22222222222${index}`, action, created_at: "2026-09-26T12:00:00Z" }));
  } };
  const page = await listSchoolDashboardActivities(repository, principal);
  assert.equal(params[0], schoolId);
  for (const action of actions) assert.ok(params[1].includes(action));
  assert.deepEqual(page.items.map((item) => item.label), ["Appel enregistré", "Appel enregistré", "Cours planifié", "Planning modifié", "Cours annulé", "Paiement enregistré"]);
  assert.doesNotMatch(sql, /old_value|ip_address|user_agent|student_name|studentName/);
});

test("planning move projects weekday and time without payment identity", () => {
  const { projectActivityDetail } = require("../lib/schoolDashboardActivities");
  assert.equal(
    projectActivityDetail({
      action: "update_course_schedule",
      day_of_week: "1",
      start_time: "08:00:00",
      end_time: "09:30",
      class_name: "6ème A",
      subject_name: "Mathématiques",
      student_name: "Ne pas afficher",
    }),
    "6ème A · Mathématiques · lundi 08:00–09:30",
  );
  assert.match(
    projectActivityDetail({ action: "create_payment", amount: "250000", currency: "CDF", student_name: "Secret" }),
    /^250[ \u00a0\u202f]000 CDF$/,
  );
  assert.equal(projectActivityDetail({ action: "upsert_attendance_batch", attendance_count: "28" }), "28 présences");
});
