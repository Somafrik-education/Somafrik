"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveFinanceSchoolScope,
  schoolCodeInScope,
  schoolRecordInFinanceScope,
  primaryFinanceSchoolCode,
} = require("./financeSchoolScope");
const { assertTenant } = require("./financeService");
const { mapGridRow, publicSchoolIdentity } = require("./financeManagement");

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

test("Lot B : mapGridRow projette login_code, jamais school_code transition", () => {
  assert.equal(
    publicSchoolIdentity({ school_code: "SCH-F8-A", login_code: "CI-EA-26-001" }),
    "CI-EA-26-001",
  );
  const mapped = mapGridRow({
    id: "g1",
    grid_code: "FEEGRID-1",
    school_id: "s1",
    school_code: "SCH-F8-A",
    login_code: "CI-EA-26-001",
    class_name: "6ème A",
    academic_year: "2025-2026",
    status: "Active",
    currency: "XOF",
  });
  assert.equal(mapped.schoolCode, "CI-EA-26-001");
  assert.equal(mapped.loginCode, "CI-EA-26-001");
  assert.equal(mapped.login_code, "CI-EA-26-001");
});

test("Lot B : schoolRecordInFinanceScope lit login_code, jamais school_code", () => {
  const principal = { role: "Comptable", schoolCode: "CI-EA-26-001" };
  const scope = resolveFinanceSchoolScope(principal);
  assert.equal(
    schoolRecordInFinanceScope(
      { school_code: "SCH-F8-A", login_code: "CI-EA-26-001", code: "CI-EA-26-001" },
      scope,
    ),
    true,
  );
  assert.equal(
    schoolRecordInFinanceScope(
      { school_code: "CI-EA-26-001", login_code: "CI-EB-26-002", code: "CI-EB-26-002" },
      scope,
    ),
    false,
  );
});

test("Lot B : schoolRecordInFinanceScope fail-closed sans login_code", () => {
  const principal = { role: "Comptable", schoolCode: "CI-EA-26-001" };
  const scope = resolveFinanceSchoolScope(principal);
  assert.equal(
    schoolRecordInFinanceScope(
      { code: "SCH-F8-A", schoolCode: "SCH-F8-A", school_code: "SCH-F8-A" },
      scope,
    ),
    false,
  );
  assert.equal(
    schoolRecordInFinanceScope(
      { code: "CI-EA-26-001", schoolCode: "CI-EA-26-001" },
      scope,
    ),
    false,
  );
});

test("F8-P0-004: schoolCode * n'est plus un passe-partout hors Superadmin", () => {
  const scope = resolveFinanceSchoolScope({
    role: "Comptable",
    schoolCode: "*",
  });
  assert.equal(scope.mode, "none");
});
