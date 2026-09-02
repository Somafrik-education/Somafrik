"use strict";

const assert = require("node:assert/strict");
const { generateNextStudentCode, formatStudentCode, studentCodePrefix } = require("./studentCodeGeneration");
const { assignCanonicalStudentCode } = require("./studentCodeAllocation");

const nuru = { name: "Institut Nuru", login_code: "CD-IN-26-001" };
const hope = { lastName: "OKITO", firstName: "Hope Sabrina" };
const jean = { lastName: "KABILA", firstName: "Jean Pierre" };

assert.equal(assignCanonicalStudentCode(nuru, [], "PENDING", hope), "CD-IN-OHS-26-00001");
assert.equal(
  assignCanonicalStudentCode(nuru, [], "CD-IN-OHS-26-00007", hope),
  "CD-IN-OHS-26-00007",
);
assert.throws(
  () => assignCanonicalStudentCode(nuru, [], "PENDING", {}),
  (error) => error.code === "STUDENT_INITIALS_REQUIRED",
);
assert.throws(
  () => assignCanonicalStudentCode(nuru, [], "PENDING"),
  (error) => error.code === "STUDENT_INITIALS_REQUIRED",
);

assert.equal(generateNextStudentCode("CD-2026-0001", [], nuru, hope), "CD-IN-OHS-26-00001");
assert.equal(
  generateNextStudentCode("CD-2026-0001", ["CD-IN-OHS-26-00003"], nuru, jean),
  "CD-IN-KJP-26-00004",
);
assert.equal(formatStudentCode("CD-2026-0001", 1, nuru, hope), "CD-IN-OHS-26-00001");
assert.equal(studentCodePrefix("CD-2026-0001", nuru, hope), "CD-IN-OHS-26-");
assert.equal(isCanonical("CD-IN-OHS-26-00001"), true);
assert.equal(isCanonical("CD-IN-EL-26-001"), false);

function isCanonical(value) {
  return /^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]{1,5}-[0-9]{2}-[0-9]{5}$/.test(value);
}

console.log("studentCodeGeneration.test.js: OK");
