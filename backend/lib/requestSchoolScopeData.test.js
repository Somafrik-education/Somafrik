"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TenantScopeService } = require("../services/tenantScopeService");
const { resolveEffectiveSchoolScope } = require("./principalSchoolScope");

const tenantScopeService = new TenantScopeService();

const nuru = {
  id: "school-nuru",
  code: "SCH-ABC123",
  school_code: "SCH-ABC123",
  loginCode: "CD-IN-26-001",
  login_code: "CD-IN-26-001",
  publicId: "CD-IN-26-001",
  countryCode: "CD",
  country: "RDC",
};

const lumiere = {
  id: "school-lumiere",
  code: "SCH-DEF456",
  school_code: "SCH-DEF456",
  loginCode: "CD-EL-26-002",
  login_code: "CD-EL-26-002",
  publicId: "CD-EL-26-002",
  countryCode: "CD",
  country: "RDC",
};

function selectedSuperadmin(school = nuru) {
  return resolveEffectiveSchoolScope({
    principal: { role: "Super Administrateur Somafrik", schoolCode: "*", sub: "super-1" },
    requestedSchoolCode: school.loginCode,
    school,
  });
}

function selectedCountryAdmin(school = nuru) {
  return resolveEffectiveSchoolScope({
    principal: {
      role: "Admin Pays",
      schoolCode: "*",
      countryCode: "CD",
      countryScope: "RDC",
      sub: "country-1",
    },
    requestedSchoolCode: school.loginCode,
    school,
  });
}

const mixedTenantRows = [
  {
    id: "nuru-public",
    schoolCode: "SCH-ABC123",
    schoolPublicCode: "CD-IN-26-001",
  },
  {
    id: "nuru-internal-only",
    schoolCode: "SCH-ABC123",
  },
  {
    id: "lumiere-public",
    schoolCode: "SCH-DEF456",
    schoolPublicCode: "CD-EL-26-002",
  },
];

test("Superadmin sans école sélectionnée conserve sa vue globale", () => {
  const rows = tenantScopeService.filterRows(mixedTenantRows, {
    role: "Super Administrateur Somafrik",
    schoolCode: "*",
  });
  assert.deepEqual(rows.map((row) => row.id), [
    "nuru-public",
    "nuru-internal-only",
    "lumiere-public",
  ]);
});

test("Superadmin + Nuru ne reçoit que les datasets Nuru", () => {
  const rows = tenantScopeService.filterRows(mixedTenantRows, selectedSuperadmin());
  assert.deepEqual(rows.map((row) => row.id), ["nuru-public", "nuru-internal-only"]);
});

test("Admin Pays + Nuru ne reçoit pas les autres écoles du même pays", () => {
  const rows = tenantScopeService.filterRows(mixedTenantRows, selectedCountryAdmin());
  assert.deepEqual(rows.map((row) => row.id), ["nuru-public", "nuru-internal-only"]);
});

test("switch Nuru → Lumière ne conserve aucune ligne Nuru", () => {
  const rows = tenantScopeService.filterRows(mixedTenantRows, selectedSuperadmin(lumiere));
  assert.deepEqual(rows.map((row) => row.id), ["lumiere-public"]);
});

test("scope effectif accepte les projections PostgreSQL avec alias interne seulement", () => {
  const principal = selectedSuperadmin();
  const payments = [
    { id: "pay-nuru", school_code: "SCH-ABC123", amount: 10 },
    { id: "pay-other", school_code: "SCH-DEF456", amount: 20 },
  ];
  const scoped = tenantScopeService.filterRows(payments, principal, { schoolField: "school_code" });
  assert.deepEqual(scoped.map((row) => row.id), ["pay-nuru"]);
});

test("scope effectif accepte les projections publiques login_code", () => {
  const principal = selectedSuperadmin();
  const courses = [
    { id: "course-nuru", school_login_code: "CD-IN-26-001" },
    { id: "course-other", school_login_code: "CD-EL-26-002" },
  ];
  const scoped = tenantScopeService.filterRows(courses, principal);
  assert.deepEqual(scoped.map((row) => row.id), ["course-nuru"]);
});

test("Admin School avec scope V2 validé peut relire son alias PostgreSQL interne", () => {
  const principal = resolveEffectiveSchoolScope({
    principal: { role: "Admin School", schoolCode: "SCH-ABC123" },
    requestedSchoolCode: "CD-IN-26-001",
    school: nuru,
  });
  assert.doesNotThrow(() => tenantScopeService.assertSchoolAccess(principal, "SCH-ABC123"));
  assert.doesNotThrow(() => tenantScopeService.assertSchoolAccess(principal, "CD-IN-26-001"));
  assert.throws(
    () => tenantScopeService.assertSchoolAccess(principal, "SCH-DEF456"),
    (error) => error?.statusCode === 403,
  );
});
