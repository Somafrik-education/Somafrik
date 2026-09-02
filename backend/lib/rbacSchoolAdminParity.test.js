"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { routePermissions } = require("../services/rbacService");
const { EstablishmentService } = require("../services/establishmentService");

const SCHOOL_A = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "CD-2026-0001",
  loginCode: "CD-IN-26-001",
  legacySchoolCode: "CD-2026-0001",
  name: "Nuru",
  countryCode: "CD",
};
const SCHOOL_B = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  code: "BI-2026-0002",
  loginCode: "BI-EC-26-001",
  legacySchoolCode: "BI-2026-0002",
  name: "Autre",
  countryCode: "BI",
};

function schoolAdmin() {
  return {
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolId: SCHOOL_A.id,
    permissions: ["Paramètres Établissement:READ", "Notifications:READ"],
  };
}

test("H. GET establishments liste ≠ GET :code pour SCHOOL_ADMIN", () => {
  assert.ok(!routePermissions["GET /api/backoffice/establishments"].includes("Paramètres Établissement:READ"));
  assert.ok(routePermissions["GET /api/backoffice/establishments/:code"].includes("Paramètres Établissement:READ"));
  assert.ok(!routePermissions["GET /api/backoffice/establishments"].includes("Notifications:READ"));
});

test("H. GET /notifications reste plateforme ; internal-notifications lit Notifications:READ", () => {
  assert.deepEqual(routePermissions["GET /api/backoffice/notifications"], [
    "ALL_PRIVILEGES",
    "COUNTRY_PRIVILEGES",
  ]);
  assert.ok(routePermissions["GET /api/backoffice/internal-notifications"].includes("Notifications:READ"));
});

test("H. GET subscription-access accepte Paramètres Établissement:READ", () => {
  assert.ok(routePermissions["GET /api/backoffice/subscription-access"].includes("Paramètres Établissement:READ"));
  assert.ok(routePermissions["GET /api/backoffice/subscription-access"].includes("ALL_PRIVILEGES"));
});

test("A. SCHOOL_ADMIN lit son établissement via GET :code", () => {
  const service = new EstablishmentService();
  const state = { schools: [SCHOOL_A, SCHOOL_B], students: [] };
  const own = service.get("CD-2026-0001", state, schoolAdmin());
  assert.equal(own.id, SCHOOL_A.id);
  const viaLogin = service.get("CD-IN-26-001", state, schoolAdmin());
  assert.equal(viaLogin.id, SCHOOL_A.id);
});

test("B. SCHOOL_ADMIN → établissement B refusé", () => {
  const service = new EstablishmentService();
  const state = { schools: [SCHOOL_A, SCHOOL_B], students: [] };
  assert.throws(
    () => service.get("BI-2026-0002", state, schoolAdmin()),
    (error) => error.statusCode === 403,
  );
});

test("C. list scopé SCHOOL_ADMIN ne retourne jamais plusieurs tenants", () => {
  const service = new EstablishmentService();
  const state = { schools: [SCHOOL_A, SCHOOL_B], students: [] };
  const rows = service.list(state, schoolAdmin());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, SCHOOL_A.id);
});
