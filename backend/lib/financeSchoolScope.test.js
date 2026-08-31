"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachFinanceMembershipScope,
  resolveFinanceSchoolScope,
  schoolCodeInScope,
  schoolRecordInFinanceScope,
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

test("F8-P0-004: leftover JWT n'est plus l'autorité Finance", () => {
  const scope = resolveFinanceSchoolScope({
    role: "Comptable",
    schoolCode: "CD-2026-0001",
    sub: "user-uuid",
  });
  assert.equal(scope.mode, "none");
});

test("GP-005: membership login_code est l'autorité, leftover ignoré", () => {
  const principal = {
    role: "Comptable",
    schoolCode: "CD-2026-0001",
    financeLoginCode: "CD-LAC-26-001",
    sub: "user-uuid",
  };
  const scope = resolveFinanceSchoolScope(principal);
  assert.equal(scope.mode, "schools");
  assert.deepEqual(scope.codes, ["CD-LAC-26-001"]);
  assert.equal(schoolCodeInScope("CD-LAC-26-001", scope), true);
  assert.equal(schoolCodeInScope("CD-2026-0001", scope), false);
  assert.doesNotThrow(() => assertTenant(principal, "CD-LAC-26-001"));
  assert.throws(
    () => assertTenant(principal, "CD-2026-0001"),
    (error) => error.statusCode === 403,
  );
});

test("F8-P0-004: schoolCode vide + financeLoginCode A n'autorise pas B", () => {
  const principal = {
    role: "Comptable",
    schoolCode: "",
    financeLoginCode: "SCH-F8-A",
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
    financeLoginCode: "SCH-F8-A",
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

test("F8-P1-006: Admin Pays n'utilise pas le préfixe schoolCode comme autorité pays", () => {
  const principal = {
    role: "Admin Pays",
    schoolCode: "",
    countryCode: "CI",
  };
  const scope = resolveFinanceSchoolScope(principal);
  assert.equal(scope.mode, "country");
  assert.equal(scope.countryCode, "CI");
  assert.equal(schoolCodeInScope("SCH-F8-A", scope), false, "préfixe SCH n'autorise pas");
  assert.equal(schoolCodeInScope("CI-XX-26-001", scope), false, "préfixe CI n'autorise pas");
  assert.equal(
    schoolCodeInScope("SCH-F8-A", scope, { countryIso: "CI" }),
    true,
    "iso_code CI autorise SCH-F8-A",
  );
  assert.equal(schoolRecordInFinanceScope({ schoolCode: "SCH-F8-A", countryIso: "CI" }, scope), true);
  assert.equal(schoolRecordInFinanceScope({ schoolCode: "CI-TRAP-26-001", countryIso: "FR" }, scope), false);
  assert.throws(
    () => assertTenant(principal, "SCH-F8-A"),
    (error) => error.statusCode === 403,
    "assertTenant ne doit pas décider du pays à partir du schoolCode seul",
  );
  assert.doesNotThrow(() => assertTenant(principal, { schoolCode: "SCH-F8-A", countryIso: "CI" }));
  assert.throws(
    () => assertTenant(principal, { schoolCode: "CI-TRAP-26-001", countryIso: "FR" }),
    (error) => error.statusCode === 403,
  );
});

test("F8-P0-004: schoolCode * n'est plus un passe-partout hors Superadmin", () => {
  const scope = resolveFinanceSchoolScope({
    role: "Comptable",
    schoolCode: "*",
  });
  assert.equal(scope.mode, "none");
});

test("GP-005: attachFinanceMembershipScope lit users.school_id → login_code", async () => {
  const one = async (sql, params) => {
    assert.match(String(sql), /users u/i);
    assert.equal(params[0], "user-uuid-1");
    return { login_code: "CD-LAC-26-001" };
  };
  const attached = await attachFinanceMembershipScope(
    { role: "Comptable", sub: "user-uuid-1", schoolCode: "CD-2026-0001" },
    one,
  );
  assert.equal(attached.financeLoginCode, "CD-LAC-26-001");
  assert.equal(attached.schoolCode, "CD-2026-0001");
  const scope = resolveFinanceSchoolScope(attached);
  assert.deepEqual(scope.codes, ["CD-LAC-26-001"]);
});

test("GP-005: attach sans `one` fail-closed (leftover JWT ignoré)", async () => {
  const attached = await attachFinanceMembershipScope(
    { role: "Comptable", sub: "user-uuid-1", schoolCode: "CD-2026-0001" },
    null,
  );
  assert.equal(attached.financeLoginCode, "");
  assert.equal(resolveFinanceSchoolScope(attached).mode, "none");
});

test("GP-005: Superadmin request-scoped résout leftover → login_code", async () => {
  const one = async (sql, params) => {
    assert.match(String(sql), /FROM schools/i);
    assert.equal(params[0], "CD-2026-0001");
    return { login_code: "CD-LAC-26-001" };
  };
  const attached = await attachFinanceMembershipScope(
    {
      role: "Super Administrateur Somafrik",
      schoolCode: "",
      effectiveSchoolCode: "CD-2026-0001",
      schoolScopeSource: "request",
    },
    one,
  );
  assert.equal(attached.financeLoginCode, "CD-LAC-26-001");
  assert.deepEqual(resolveFinanceSchoolScope(attached).codes, ["CD-LAC-26-001"]);
});

test("GP-005: sqlSchoolPredicate cible login_code (repli school_code si vide)", () => {
  const { sqlSchoolPredicate } = require("./financeSchoolScope");
  const params = [];
  const pred = sqlSchoolPredicate("s", { mode: "schools", codes: ["CD-LAC-26-001"] }, params);
  assert.match(pred, /login_code/);
  assert.match(pred, /school_code/);
  assert.deepEqual(params, [["CD-LAC-26-001"]]);
});
