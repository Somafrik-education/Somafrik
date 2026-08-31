"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  scopeAcademicYearList,
  findExistingAcademicYear,
} = require("./academicYearReadScope");

const leftover = "CD-2026-0001";
const canonical = "CD-SY-26-001";
const otherLogin = "BI-SY-26-002";

const yearA = {
  id: "ay-a",
  name: "2025-2026",
  schoolId: "sch-a",
  schoolCode: canonical,
  countryCode: "CD",
};
const yearB = {
  id: "ay-b",
  name: "2025-2026",
  schoolId: "sch-b",
  schoolCode: otherLogin,
  countryCode: "BI",
};

const schoolA = { id: "sch-a", login_code: canonical, country_iso: "CD" };

function lookups(school = schoolA) {
  return {
    getSchoolForPrincipalUser: async (principal) => {
      if (principal?.sub === "user-a") return school;
      return null;
    },
  };
}

test("GET années : leftover JWT + membership UUID expose login_code, pas le leftover", async () => {
  const scoped = await scopeAcademicYearList({
    rows: [yearA, yearB],
    principal: { sub: "user-a", role: "Admin School", schoolCode: leftover },
    ...lookups(),
  });
  assert.deepEqual(scoped.map((row) => row.id), ["ay-a"]);
  assert.equal(scoped[0].schoolCode, canonical);
  assert.notEqual(scoped[0].schoolCode, leftover);
});

test("GET années : isolation inter-tenant", async () => {
  const scoped = await scopeAcademicYearList({
    rows: [yearA, yearB],
    principal: { sub: "user-a", role: "Admin School", schoolCode: leftover },
    ...lookups(),
  });
  assert.equal(scoped.some((row) => row.schoolCode === otherLogin), false);
});

test("GET années : Superadmin sans request-scope voit tout", async () => {
  const scoped = await scopeAcademicYearList({
    rows: [yearA, yearB],
    principal: { role: "Super Administrateur Somafrik", schoolCode: leftover },
    ...lookups(),
  });
  assert.equal(scoped.length, 2);
});

test("GET années : Admin Pays reste filtré par pays", async () => {
  const scoped = await scopeAcademicYearList({
    rows: [yearA, yearB],
    principal: { role: "Admin Pays", countryCode: "CD", schoolCode: leftover },
    ...lookups(),
  });
  assert.deepEqual(scoped.map((row) => row.id), ["ay-a"]);
});

test("ensureSchoolYear : leftover réutilise l'année déjà scoped, sans POST", () => {
  const existing = findExistingAcademicYear([yearA], "2025-2026", leftover);
  assert.equal(existing?.id, "ay-a");
  assert.equal(existing.schoolCode, canonical);
});

test("ensureSchoolYear : login_code canonique réutilise l'année", () => {
  const existing = findExistingAcademicYear([yearA, yearB], "2025-2026", canonical);
  assert.equal(existing?.id, "ay-a");
});

test("ensureSchoolYear : Superadmin multi-tenant leftover ne pioche pas au hasard", () => {
  const existing = findExistingAcademicYear([yearA, yearB], "2025-2026", leftover);
  assert.equal(existing, null);
});
