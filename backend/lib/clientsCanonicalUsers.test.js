"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mergeUserProfileForUpdate } = require("./clientsRolePolicy");
const {
  fromDbStatus,
  toDbStatus,
  mapUserRow,
  validatePersonName,
  ignoreClientScope,
} = require("./clientsManagement");

test("mergeUserProfileForUpdate persiste les champs de validation", () => {
  const merged = mergeUserProfileForUpdate(
    { identifier: "admin@school.test" },
    {
      validationStatus: "Validé",
      validatedBy: "superadmin",
      validatedAt: "2026-08-14T10:00:00.000Z",
    },
  );
  assert.equal(merged.validationStatus, "Validé");
  assert.equal(merged.validatedBy, "superadmin");
  assert.equal(merged.validatedAt, "2026-08-14T10:00:00.000Z");
});

test("toDbStatus/fromDbStatus gère En attente de validation", () => {
  assert.equal(toDbStatus("En attente de validation"), "pending_validation");
  assert.equal(fromDbStatus("pending_validation"), "En attente de validation");
});

test("nom/prénom utilisateur refusent number et chaîne uniquement numérique", () => {
  for (const value of [123, 0, "123", "  456  "]) {
    assert.throws(
      () => validatePersonName(value, "firstName"),
      (error) => error.statusCode === 400,
      `firstName numérique doit être refusé: ${JSON.stringify(value)}`,
    );
    assert.throws(
      () => validatePersonName(value, "lastName"),
      (error) => error.statusCode === 400,
      `lastName numérique doit être refusé: ${JSON.stringify(value)}`,
    );
  }
});

test("ignoreClientScope applique la validation aux mutations utilisateurs/contacts", () => {
  assert.throws(
    () => ignoreClientScope({ firstName: 123, lastName: "Okito" }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => ignoreClientScope({ firstName: "Awa", lastName: "456" }),
    (error) => error.statusCode === 400,
  );
  const normalized = ignoreClientScope({ firstName: " Élodie ", lastName: " O'Connor-Smith " });
  assert.equal(normalized.firstName, "Élodie");
  assert.equal(normalized.lastName, "O'Connor-Smith");
});

test("nom/prénom utilisateur conservent accents, espaces, apostrophes et tirets", () => {
  assert.equal(validatePersonName("  Élodie  ", "firstName"), "Élodie");
  assert.equal(validatePersonName("Jean-Pierre", "firstName"), "Jean-Pierre");
  assert.equal(validatePersonName("O'Connor", "lastName"), "O'Connor");
  assert.equal(validatePersonName("De la Croix", "lastName"), "De la Croix");
});

test("mapUserRow expose validationStatus depuis profile_payload", () => {
  const row = mapUserRow({
    id: "11111111-1111-1111-1111-111111111111",
    user_code: "USR-TEST",
    first_name: "Ada",
    last_name: "Lovelace",
    role: "SCHOOL_ADMIN",
    status: "pending_validation",
    school_code: "CD-2026-0001",
    school_login_code: "CD-IN-26-001",
    school_name: "INSTITUT NURU",
    profile_payload: {
      identifier: "ada@school.test",
      validationStatus: "En attente de validation",
      validationRequestedBy: "country-admin",
    },
  });
  assert.equal(row.status, "En attente de validation");
  assert.equal(row.validationStatus, "En attente de validation");
  assert.equal(row.validationRequestedBy, "country-admin");
  assert.equal(row.schoolCode, "CD-2026-0001");
  assert.equal(row.schoolPublicCode, "CD-IN-26-001");
  assert.equal(row.schoolName, "INSTITUT NURU");
});
