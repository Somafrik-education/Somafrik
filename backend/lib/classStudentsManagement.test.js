"use strict";

const assert = require("node:assert/strict");
const {
  validateEnrollStudentInput,
  assertEnrollmentScopeImmutable,
} = require("./classStudentsManagement");

function testImmutableScope() {
  assert.throws(
    () => assertEnrollmentScopeImmutable({ classCode: "OTHER" }, "SCH-A", "CLS-A"),
    (error) => error.statusCode === 403,
  );
  assert.throws(
    () => assertEnrollmentScopeImmutable({ schoolCode: "SCH-B" }, "SCH-A", "CLS-A"),
    (error) => error.statusCode === 403,
  );
  assert.throws(
    () => assertEnrollmentScopeImmutable({ className: "6ème A" }, "SCH-A", "CLS-A"),
    (error) => error.statusCode === 400,
  );
}

function testValidInput() {
  const input = validateEnrollStudentInput(
    { firstName: "Awa", lastName: "Diop", gender: "Féminin" },
    "SCH-A",
    "CLS-A",
  );
  assert.equal(input.firstName, "Awa");
  assert.equal(input.lastName, "Diop");
  assert.equal(input.gender, "Féminin");
}

function testMissingNames() {
  assert.throws(
    () => validateEnrollStudentInput({ lastName: "Diop" }, "SCH-A", "CLS-A"),
    (error) => error.statusCode === 400,
  );
}

function main() {
  testImmutableScope();
  testValidInput();
  testMissingNames();
  console.log("classStudentsManagement.test.js: OK");
}

main();
