"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mergeUserProfileForUpdate } = require("./clientsRolePolicy");
const { fromDbStatus, toDbStatus, mapUserRow } = require("./clientsManagement");

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
  assert.equal(row.schoolCode, "CD-IN-26-001");
  assert.equal(row.schoolPublicCode, "CD-IN-26-001");
  assert.equal(row.schoolName, "INSTITUT NURU");
});
