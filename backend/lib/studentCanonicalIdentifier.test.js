"use strict";

const assert = require("node:assert/strict");
const {
  formatStudentCanonicalCode,
  generateNextStudentCanonicalCode,
  isStudentCanonicalCode,
  parseStudentCanonicalCode,
  resolveSchoolIdentityContext,
  studentIdentityInitials,
} = require("./studentCanonicalIdentifier");

assert.equal(studentIdentityInitials("OKITO", "Hope Sabrina"), "OHS");
assert.equal(
  formatStudentCanonicalCode({ countryCode: "cd", schoolInitials: "in", studentInitials: "ohs", year: 2026, sequence: 1 }),
  "CD-IN-OHS-26-00001",
);
assert.equal(isStudentCanonicalCode("CD-IN-OHS-26-00001"), true);
assert.equal(isStudentCanonicalCode("CD-IN-EL-26-001"), false);
assert.equal(isStudentCanonicalCode("PENDING"), false);

assert.deepEqual(parseStudentCanonicalCode("cd-in-ohs-26-00001"), {
  countryCode: "CD",
  schoolInitials: "IN",
  studentInitials: "OHS",
  yearShort: "26",
  sequence: 1,
});

assert.equal(
  generateNextStudentCanonicalCode({
    countryCode: "CD",
    schoolInitials: "IN",
    firstName: "Hope Sabrina",
    lastName: "OKITO",
    year: 2026,
    existingCodes: [],
  }),
  "CD-IN-OHS-26-00001",
);
assert.equal(
  generateNextStudentCanonicalCode({
    countryCode: "CD",
    schoolInitials: "IN",
    firstName: "Jean Pierre",
    lastName: "KABILA",
    year: 2026,
    existingCodes: ["CD-IN-OHS-26-00001", "CD-IN-ABC-26-00003"],
  }),
  "CD-IN-KJP-26-00004",
);

assert.deepEqual(resolveSchoolIdentityContext({ loginCode: "CD-IN-26-001" }), {
  countryCode: "CD",
  schoolInitials: "IN",
});
assert.deepEqual(
  resolveSchoolIdentityContext({ name: "Institut Nuru", school_code: "CD-2026-0001" }),
  { countryCode: "CD", schoolInitials: "IN" },
);

assert.throws(
  () => formatStudentCanonicalCode({ countryCode: "CD", schoolInitials: "IN", studentInitials: "OHS", year: 2026, sequence: 100000 }),
  (error) => error.code === "STUDENT_SEQUENCE_EXHAUSTED",
);

console.log("studentCanonicalIdentifier.test.js OK");
