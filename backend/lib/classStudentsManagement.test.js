"use strict";

const assert = require("node:assert/strict");
const {
  validateEnrollStudentInput,
  validateUpdateStudentInput,
  assertEnrollmentScopeImmutable,
  parseAndValidateBirthDate,
} = require("./classStudentsManagement");

function testForbiddenKeysAlwaysRejected() {
  for (const key of [
    "classCode",
    "class_code",
    "schoolCode",
    "school_code",
    "className",
    "class_name",
    "schoolId",
    "school_id",
    "academicYearId",
    "academic_year_id",
    "matricule",
    "studentCode",
    "loginCode",
    "identityCode",
    "identifier",
    "publicId",
  ]) {
    assert.throws(
      () => assertEnrollmentScopeImmutable({ [key]: "" }),
      (error) => error.statusCode === 400,
      `empty ${key} must be rejected`,
    );
    assert.throws(
      () => assertEnrollmentScopeImmutable({ [key]: "matching-value" }),
      (error) => error.statusCode === 400,
      `non-empty ${key} must be rejected`,
    );
  }
}

function testValidInput() {
  const input = validateEnrollStudentInput(
    { firstName: "Awa", lastName: "Diop", gender: "Féminin" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(input.firstName, "Awa");
  assert.equal(input.lastName, "Diop");
}

function testPersonNameValidation() {
  for (const bad of [123, "123", "  456  "]) {
    assert.throws(
      () => validateEnrollStudentInput({ firstName: bad, lastName: "Diop" }, "SCH-A", "CLS-A"),
      (error) => error.statusCode === 400,
      `firstName numérique doit être refusé: ${JSON.stringify(bad)}`,
    );
    assert.throws(
      () => validateEnrollStudentInput({ firstName: "Awa", lastName: bad }, "SCH-A", "CLS-A"),
      (error) => error.statusCode === 400,
      `lastName numérique doit être refusé: ${JSON.stringify(bad)}`,
    );
  }
  assert.throws(
    () => validateUpdateStudentInput({ firstName: "123", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }),
    (error) => error.statusCode === 400,
  );
  const accents = validateEnrollStudentInput(
    { firstName: " Élodie ", lastName: "O'Connor-Smith" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(accents.firstName, "Élodie");
  assert.equal(accents.lastName, "O'Connor-Smith");
}

function testBirthDateValidation() {
  assert.throws(
    () => parseAndValidateBirthDate("2026-02-30"),
    (error) => error.statusCode === 400,
  );
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const future = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;
  assert.throws(
    () => parseAndValidateBirthDate(future),
    (error) => error.statusCode === 400,
  );
  assert.equal(parseAndValidateBirthDate("2012-04-12"), "2012-04-12");
}

function testUpdateRejectsScopeAndRequiresConflictToken() {
  assert.throws(
    () =>
      validateUpdateStudentInput({
        firstName: "Awa",
        classCode: "CLS-X",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () =>
      validateUpdateStudentInput({
        firstName: "Awa",
        schoolCode: "SCH-X",
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateUpdateStudentInput({ firstName: "Awa" }),
    (error) => error.statusCode === 400,
  );
  const patch = validateUpdateStudentInput({
    parentPhone: "+243 820 000 001",
    expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(patch.parentPhone, "+243 820 000 001");
  assert.equal(patch.expectedUpdatedAt, "2026-01-01T00:00:00.000Z");
}

function testParentPhoneValidation() {
  const valid = validateEnrollStudentInput(
    { firstName: "Esther", lastName: "Okito", parentPhone: "+243 820 000 001" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(valid.parentPhone, "+243 820 000 001");
  const plus33 = validateEnrollStudentInput(
    { firstName: "Esther", lastName: "Okito", parentPhone: "+33 6 12 34 56 78" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(plus33.parentPhone, "+33 6 12 34 56 78");
  const empty = validateEnrollStudentInput(
    { firstName: "Esther", lastName: "Okito", parentPhone: "" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(empty.parentPhone, null);
  assert.throws(
    () =>
      validateEnrollStudentInput(
        { firstName: "Esther", lastName: "Okito", parentPhone: "Baudouin OKITO" },
        "SCH-A",
        "CLS-A",
      ),
    (error) => error.statusCode === 400,
  );
}

function main() {
  testForbiddenKeysAlwaysRejected();
  testValidInput();
  testPersonNameValidation();
  testBirthDateValidation();
  testUpdateRejectsScopeAndRequiresConflictToken();
  testParentPhoneValidation();
  assert.throws(
    () => validateEnrollStudentInput({ lastName: "Diop" }, "SCH-A", "CLS-A"),
    (error) => error.statusCode === 400,
  );
  console.log("classStudentsManagement.test.js: OK");
}

main();
