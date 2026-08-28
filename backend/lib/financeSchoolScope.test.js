"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveFinanceSchoolScope,
  schoolCodeInScope,
  primaryFinanceSchoolCode,
} = require("./financeSchoolScope");
const { assertTenant } = require("./financeService");

test("F8-P0-004: schoolCode vide sans scope effectif = fail-closed", () => {
  const scope = resolveFinanceSchoolScope({
    role: "Comptable",
    schoolCode: "",
  });
  assert.equal(scope.mode, "none");
  assert.equal(schoolCodeInScope("SCH-F8-A", scope), false);
  assert.equal(primaryFinanceSchoolCode({ role: "Comptable", schoolCode: "" }), "");
  assert.throws(
    () => assertTenant({ role: "Comptable", schoolCode: "" }, "SCH-F8-A"),
    (error) => error.statusCode === 403,
  );
});

test("F8-P0-004: schoolCode vide + effectiveSchoolCode A n'autorise pas B", () => {
  const principal = {
    role: "Comptable",
    schoolCode: "",
    effectiveSchoolCode: "SCH-F8-A",
    schoolScopeSource: "request",
  };
  const scope = resolveFinanceSchoolScope(principal);
  assert.equal(scope.mode, "schools");
  assert.deepEqual(scope.codes, ["SCH-F8-A"]);
  assert.equal(schoolCodeInScope("SCH-F8-A", scope), true);
  assert.equal(schoolCodeInScope("SCH-F8-B", scope), false);
  assert.doesNotThrow(() => assertTenant(principal, "SCH-F8-A"));
  assert.throws(
    () => assertTenant(principal, "SCH-F8-B"),
    (error) => error.statusCode === 403,
  );
});

test("F8-P0-004: Superadmin request-scoped A ne sort pas de A", () => {
  const principal = {
    role: "Super Administrateur Somafrik",
    schoolCode: "",
    effectiveSchoolCode: "SCH-F8-A",
    schoolScopeSource: "request",
  };
  const scope = resolveFinanceSchoolScope(principal);
  assert.equal(scope.mode, "schools");
  assert.equal(schoolCodeInScope("SCH-F8-B", scope), false);
});

test("F8-P0-004: Superadmin global sans request scope reste global", () => {
  const principal = {
    role: "Super Administrateur Somafrik",
    schoolCode: "",
  };
  const scope = resolveFinanceSchoolScope(principal);
  assert.equal(scope.mode, "all");
  assert.equal(schoolCodeInScope("SCH-F8-B", scope), true);
});

test("F8-P0-004: Admin Pays sans école effective = pays uniquement", () => {
  const principal = {
    role: "Admin Pays",
    schoolCode: "",
    countryCode: "CI",
  };
  const scope = resolveFinanceSchoolScope(principal);
  assert.equal(scope.mode, "country");
  assert.equal(scope.countryCode, "CI");
  assert.equal(schoolCodeInScope("CI-XX-26-001", scope), true);
  assert.equal(schoolCodeInScope("FR-XX-26-001", scope), false);
});

test("F8-P0-004: schoolCode * n'est plus un passe-partout hors Superadmin", () => {
  const scope = resolveFinanceSchoolScope({
    role: "Comptable",
    schoolCode: "*",
  });
  assert.equal(scope.mode, "none");
});
