"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveReportCardActorFromPrincipal } = require("./reportCardHttpActor");

const SUBMIT = "REPORT_CARD_SUBMIT_MODEL";
const APPROVE = "REPORT_CARD_SCHOOL_APPROVE_TEMPLATE";
const CONFIGURE = "REPORT_CARD_CONFIGURE";

function principal(overrides = {}) {
  return {
    sub: "user-1",
    schoolId: "school-a",
    role: "Enseignant",
    permissions: [],
    ...overrides,
  };
}

test("report-card-lot7-actor-read-is-not-submit", () => {
  const actor = resolveReportCardActorFromPrincipal(
    principal({ role: "Enseignant", permissions: ["Bulletins:READ"] })
  );
  assert.equal(actor.permissions.includes(SUBMIT), false);
  assert.equal(actor.permissions.includes(APPROVE), false);
  assert.equal(actor.permissions.includes(CONFIGURE), false);
});

test("report-card-lot7-actor-create-can-submit", () => {
  const actor = resolveReportCardActorFromPrincipal(
    principal({
      role: "Proviseur",
      permissions: ["Bulletins:CREATE", "Bulletins:READ"],
    })
  );
  assert.equal(actor.permissions.includes(SUBMIT), true);
  assert.equal(actor.permissions.includes(APPROVE), false);
});

test("report-card-lot7-actor-update-can-approve", () => {
  const actor = resolveReportCardActorFromPrincipal(
    principal({
      role: "Proviseur",
      permissions: ["Bulletins:UPDATE", "Bulletins:READ"],
    })
  );
  assert.equal(actor.permissions.includes(APPROVE), true);
  assert.equal(actor.permissions.includes(SUBMIT), false);
});

test("report-card-lot7-actor-admin-school-read-cannot-write", () => {
  const actor = resolveReportCardActorFromPrincipal(
    principal({
      role: "Admin School",
      permissions: ["Bulletins:READ"],
    })
  );
  assert.equal(actor.permissions.includes(SUBMIT), false);
  assert.equal(actor.permissions.includes(APPROVE), false);
});

test("report-card-lot7-actor-removed-permission-is-not-restored-by-role", () => {
  const actor = resolveReportCardActorFromPrincipal(
    principal({
      role: "Admin School",
      permissions: [],
    })
  );
  assert.deepEqual(actor.permissions, []);
});

test("report-card-lot7-actor-uses-effective-permissions-and-school-code", () => {
  const actor = resolveReportCardActorFromPrincipal({
    sub: "user-2",
    schoolCode: "ECOLE1",
    role: "Directeur",
    effectivePermissions: ["Bulletins:CREATE", "Bulletins:UPDATE"],
  });
  assert.equal(actor.actorSchoolId, "ECOLE1");
  assert.equal(actor.permissions.includes(SUBMIT), true);
  assert.equal(actor.permissions.includes(APPROVE), true);
});
