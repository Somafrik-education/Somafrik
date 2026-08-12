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
    parentPhone: "+2431",
    expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(patch.parentPhone, "+2431");
  assert.equal(patch.expectedUpdatedAt, "2026-01-01T00:00:00.000Z");
}

function main() {
  testForbiddenKeysAlwaysRejected();
  testValidInput();
  testBirthDateValidation();
  testUpdateRejectsScopeAndRequiresConflictToken();
  assert.throws(
    () => validateEnrollStudentInput({ lastName: "Diop" }, "SCH-A", "CLS-A"),
    (error) => error.statusCode === 400,
  );
  console.log("classStudentsManagement.test.js: OK");
}

main();
