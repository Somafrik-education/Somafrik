"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveAcademicYearCreateTenant } = require("./academicYearTenant");

const leftover = "CD-2026-0001";
const canonical = "CD-SY-26-001";
const otherLogin = "BI-SY-26-002";

const schoolA = { id: "sch-a", login_code: canonical, country_iso: "CD" };
const schoolB = { id: "sch-b", login_code: otherLogin, country_iso: "BI" };

function lookups() {
  return {
    getSchoolByLoginCode: async (code) => {
      if (code === canonical) return schoolA;
      if (code === otherLogin) return schoolB;
      return null;
    },
    getSchoolForPrincipalUser: async (principal) => {
      if (principal?.sub === "user-a") return schoolA;
      if (principal?.sub === "user-b") return schoolB;
      return null;
    },
  };
}

test("tenant année scolaire : leftover body refusé", async () => {
  await assert.rejects(
    () =>
      resolveAcademicYearCreateTenant({
        principal: { sub: "user-a", role: "Admin School", schoolCode: leftover },
        bodySchoolCode: leftover,
        ...lookups(),
      }),
    (error) => error.statusCode === 403 && /hors périmètre/.test(error.message),
  );
});

test("tenant année scolaire : login_code canonique accepté même si JWT leftover", async () => {
  const resolved = await resolveAcademicYearCreateTenant({
    principal: { sub: "user-a", role: "Admin School", schoolCode: leftover },
    bodySchoolCode: canonical,
    ...lookups(),
  });
  assert.equal(resolved.schoolCode, canonical);
  assert.notEqual(leftover, canonical);
});

test("tenant année scolaire : isolation inter-tenant", async () => {
  await assert.rejects(
    () =>
      resolveAcademicYearCreateTenant({
        principal: { sub: "user-a", role: "Admin School", schoolCode: leftover },
        bodySchoolCode: otherLogin,
        ...lookups(),
      }),
    (error) => error.statusCode === 403,
  );
});

test("tenant année scolaire : body omis résout l'école du user, jamais le leftover", async () => {
  const resolved = await resolveAcademicYearCreateTenant({
    principal: { sub: "user-a", role: "Admin School", schoolCode: leftover },
    bodySchoolCode: "",
    ...lookups(),
  });
  assert.equal(resolved.schoolCode, canonical);
});
