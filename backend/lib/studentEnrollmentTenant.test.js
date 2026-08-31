"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveEnrollmentTenant } = require("./studentEnrollmentTenant");

const leftover = "CD-2026-0001";
const canonical = "CD-SY-26-001";
const otherLogin = "BI-SY-26-002";

const schoolA = { id: "sch-a", login_code: canonical, school_code: leftover };
const schoolB = { id: "sch-b", login_code: otherLogin, school_code: "BI-2026-0001" };

function getSchoolForPrincipalUser(principal) {
  if (principal?.sub === "user-a") return schoolA;
  if (principal?.sub === "user-b") return schoolB;
  return null;
}

test("inscription : leftover JWT + membership → login_code, jamais school_code", async () => {
  const resolved = await resolveEnrollmentTenant({
    principal: { sub: "user-a", role: "Admin School", schoolCode: leftover },
    getSchoolForPrincipalUser,
  });
  assert.equal(resolved.school.id, "sch-a");
  assert.equal(resolved.schoolCode, canonical);
  assert.notEqual(resolved.schoolCode, leftover);
});

test("inscription : sans membership → 404 TENANT_MISMATCH", async () => {
  await assert.rejects(
    () =>
      resolveEnrollmentTenant({
        principal: { sub: "unknown", role: "Admin School", schoolCode: leftover },
        getSchoolForPrincipalUser,
      }),
    (error) => error.statusCode === 404 && error.code === "TENANT_MISMATCH",
  );
});

test("inscription : login_code absent ou leftover exposé comme login → 404", async () => {
  await assert.rejects(
    () =>
      resolveEnrollmentTenant({
        principal: { sub: "user-x", role: "Admin School", schoolCode: leftover },
        getSchoolForPrincipalUser: async () => ({ id: "sch-x", login_code: leftover }),
      }),
    (error) => error.statusCode === 404 && error.code === "TENANT_MISMATCH",
  );
});

test("inscription : lookup membership manquant → 404, pas de leftover JWT", async () => {
  await assert.rejects(
    () =>
      resolveEnrollmentTenant({
        principal: { sub: "user-a", role: "Admin School", schoolCode: leftover },
      }),
    (error) => error.statusCode === 404 && error.code === "TENANT_MISMATCH",
  );
});
