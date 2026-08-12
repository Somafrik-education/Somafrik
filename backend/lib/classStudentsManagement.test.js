"use strict";

const assert = require("node:assert/strict");
const {
  validateEnrollStudentInput,
  assertEnrollmentScopeImmutable,
  parseAndValidateBirthDate,
} = require("./classStudentsManagement");

function testForbiddenKeysAlwaysRejected() {
  for (const key of ["classCode", "schoolCode", "className", "academicYearId"]) {
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

function main() {
  testForbiddenKeysAlwaysRejected();
  testValidInput();
  testBirthDateValidation();
  assert.throws(
    () => validateEnrollStudentInput({ lastName: "Diop" }, "SCH-A", "CLS-A"),
    (error) => error.statusCode === 400,
  );
  console.log("classStudentsManagement.test.js: OK");
}

main();
