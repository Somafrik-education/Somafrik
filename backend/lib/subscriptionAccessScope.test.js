"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertSubscriptionAccessForPrincipal } = require("./subscriptionAccessScope");

const SCHOOL_A = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  school_code: "CD-2026-0001",
  login_code: "CD-IN-26-001",
  country_code: "CD",
};
const SCHOOL_B = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  school_code: "BI-2026-0002",
  login_code: "BI-EC-26-001",
  country_code: "BI",
};

function schoolAdmin(overrides = {}) {
  return {
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolId: SCHOOL_A.id,
    permissions: ["Paramètres Établissement:READ"],
    ...overrides,
  };
}

test("F. SCHOOL_ADMIN → propre tenant (UUID) autorisé", () => {
  assert.doesNotThrow(() => assertSubscriptionAccessForPrincipal(schoolAdmin(), "CD-2026-0001", SCHOOL_A));
  assert.doesNotThrow(() => assertSubscriptionAccessForPrincipal(schoolAdmin(), "CD-IN-26-001", SCHOOL_A));
});

test("G. SCHOOL_ADMIN → établissement B refusé même avec le même publicCode forgé", () => {
  assert.throws(
    () => assertSubscriptionAccessForPrincipal(schoolAdmin(), "BI-2026-0002", SCHOOL_B),
    (error) => error.statusCode === 403 || error.status === 403,
  );
});

test("G. schoolId différents + leftover query B → refus", () => {
  assert.throws(
    () =>
      assertSubscriptionAccessForPrincipal(
        schoolAdmin({ schoolCode: "BI-2026-0002" }),
        "BI-2026-0002",
        SCHOOL_B,
      ),
    (error) => error.statusCode === 403 || error.status === 403,
  );
});

test("F. sans UUID : leftover / login_code du même tenant autorisé", () => {
  const principal = schoolAdmin({ schoolId: "", effectiveSchoolId: "" });
  assert.doesNotThrow(() => assertSubscriptionAccessForPrincipal(principal, "CD-2026-0001", SCHOOL_A));
  assert.doesNotThrow(() => assertSubscriptionAccessForPrincipal(principal, "CD-IN-26-001", SCHOOL_A));
});

test("G. sans UUID : autre leftover refusé", () => {
  const principal = schoolAdmin({ schoolId: "", effectiveSchoolId: "" });
  assert.throws(
    () => assertSubscriptionAccessForPrincipal(principal, "BI-2026-0002", SCHOOL_B),
    (error) => error.statusCode === 403 || error.status === 403,
  );
});

test("Admin Pays : hors pays refusé", () => {
  const country = { role: "Admin Pays", countryCode: "CD", schoolCode: "*" };
  assert.throws(
    () => assertSubscriptionAccessForPrincipal(country, "BI-2026-0002", SCHOOL_B),
    (error) => error.statusCode === 403 || error.status === 403,
  );
  assert.doesNotThrow(() => assertSubscriptionAccessForPrincipal(country, "CD-2026-0001", SCHOOL_A));
});
