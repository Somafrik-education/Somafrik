"use strict";

const assert = require("node:assert/strict");
const {
  assertAssignableUserRole,
  assertProvisionContactRole,
  normalizeAssignableRole,
} = require("./clientsRolePolicy");
const { CLIENTS_ERROR } = require("./clientsManagement");

function expectForbidden(fn) {
  assert.throws(fn, (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.FORBIDDEN);
}

function main() {
  const schoolAdmin = { role: "Admin School", schoolCode: "CD-2026-0001" };
  const countryAdmin = { role: "Admin Pays", countryCode: "CD", schoolCode: "*" };
  const superAdmin = { role: "Super Administrateur Somafrik" };

  expectForbidden(() => assertAssignableUserRole(schoolAdmin, "Super Administrateur Somafrik"));
  expectForbidden(() => assertAssignableUserRole(schoolAdmin, "SUPER_ADMIN"));
  expectForbidden(() => assertAssignableUserRole(schoolAdmin, "Admin Pays"));
  expectForbidden(() => assertAssignableUserRole(countryAdmin, "Super Administrateur Somafrik"));

  assert.equal(assertAssignableUserRole(schoolAdmin, "Secrétaire"), "Secrétaire");
  assert.equal(assertAssignableUserRole(countryAdmin, "Admin School"), "Admin School");
  assert.equal(assertAssignableUserRole(superAdmin, "Super Administrateur Somafrik"), "Super Administrateur Somafrik");
  assert.equal(assertAssignableUserRole(superAdmin, "Admin Pays"), "Admin Pays");

  assert.equal(normalizeAssignableRole("SUPER_ADMIN"), "Super Administrateur Somafrik");
  assert.equal(assertProvisionContactRole("Parent"), "Parent");
  expectForbidden(() => assertProvisionContactRole("Enseignant"));
  expectForbidden(() => assertProvisionContactRole("Super Administrateur Somafrik"));

  console.log("clientsRolePolicy.test.js OK");
}

main();
