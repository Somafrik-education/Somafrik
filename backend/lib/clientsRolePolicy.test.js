"use strict";

const assert = require("node:assert/strict");
const {
  assertAssignableUserRole,
  assertProvisionContactRole,
  normalizeAssignableRole,
  assertSafeUserProfilePatch,
  assertWritableUserTarget,
  TEACHER_ACCOUNT_ENTRY_ERROR,
} = require("./clientsRolePolicy");
const { CLIENTS_ERROR } = require("./clientsManagement");

function expectForbidden(fn) {
  assert.throws(fn, (error) => error.statusCode === 403 && error.code === CLIENTS_ERROR.FORBIDDEN);
}

function expectTeacherEntryForbidden(fn) {
  assert.throws(
    fn,
    (error) => error.statusCode === 403 && error.code === TEACHER_ACCOUNT_ENTRY_ERROR,
  );
}

function main() {
  const schoolAdmin = { role: "Admin School", schoolCode: "CD-2026-0001" };
  const countryAdmin = { role: "Admin Pays", countryCode: "CD", schoolCode: "*" };
  const superAdmin = { role: "Super Administrateur Somafrik" };

  expectForbidden(() => assertAssignableUserRole(schoolAdmin, "Super Administrateur Somafrik"));
  expectForbidden(() => assertAssignableUserRole(schoolAdmin, "SUPER_ADMIN"));
  expectForbidden(() => assertAssignableUserRole(schoolAdmin, "Admin Pays"));
  expectForbidden(() => assertAssignableUserRole(countryAdmin, "Super Administrateur Somafrik"));

  // Le rôle Enseignant est exclusivement créé par /teachers, quel que soit le principal
  // et que le client envoie le libellé UI ou le code DB.
  expectTeacherEntryForbidden(() => assertAssignableUserRole(schoolAdmin, "Enseignant"));
  expectTeacherEntryForbidden(() => assertAssignableUserRole(schoolAdmin, "TEACHER"));
  expectTeacherEntryForbidden(() => assertAssignableUserRole(countryAdmin, "Enseignant"));
  expectTeacherEntryForbidden(() => assertAssignableUserRole(superAdmin, "TEACHER"));

  assert.equal(assertAssignableUserRole(schoolAdmin, "Secrétaire"), "Secrétaire");
  assert.equal(assertAssignableUserRole(countryAdmin, "Admin School"), "Admin School");
  assert.equal(assertAssignableUserRole(superAdmin, "Super Administrateur Somafrik"), "Super Administrateur Somafrik");
  assert.equal(assertAssignableUserRole(superAdmin, "Admin Pays"), "Admin Pays");

  assert.equal(normalizeAssignableRole("SUPER_ADMIN"), "Super Administrateur Somafrik");
  assert.equal(assertProvisionContactRole("Parent"), "Parent");
  expectForbidden(() => assertProvisionContactRole("Enseignant"));
  expectForbidden(() => assertProvisionContactRole("Super Administrateur Somafrik"));

  expectForbidden(() => assertSafeUserProfilePatch({ permissions: ["ALL_PRIVILEGES"] }));
  expectForbidden(() => assertSafeUserProfilePatch({ identifier: "hacked" }));
  assert.doesNotThrow(() => assertSafeUserProfilePatch({ photoUrl: "https://example.com/a.png" }));

  expectForbidden(() =>
    assertWritableUserTarget(
      { role: "Admin School", schoolCode: "CD-2026-0001" },
      { role: "COUNTRY_ADMIN" },
      { profile: { photoUrl: "x" } },
    ),
  );

  console.log("clientsRolePolicy.test.js OK");
}

main();
