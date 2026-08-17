"use strict";

const assert = require("node:assert/strict");
const {
  formatStudentCanonicalCode,
  generateNextStudentCanonicalCode,
  isStudentCanonicalCode,
  parseStudentCanonicalCode,
  resolveSchoolIdentityContext,
} = require("./studentCanonicalIdentifier");

assert.equal(
  formatStudentCanonicalCode({ countryCode: "cd", schoolInitials: "in", year: 2026, sequence: 1 }),
  "CD-IN-EL-26-001",
);
assert.equal(
  formatStudentCanonicalCode({ countryCode: "CD", schoolInitials: "IN", year: 2026, sequence: 12 }),
  "CD-IN-EL-26-012",
);
assert.equal(isStudentCanonicalCode("CD-IN-EL-26-001"), true);
assert.equal(isStudentCanonicalCode("ELE-CD-0001-0001-000001"), false);
assert.equal(isStudentCanonicalCode("ELE-0001"), false);
assert.equal(isStudentCanonicalCode("CD-IN-JPK-26-00004"), false);

assert.deepEqual(parseStudentCanonicalCode("cd-in-el-26-001"), {
  countryCode: "CD",
  schoolInitials: "IN",
  yearShort: "26",
  sequence: 1,
});

assert.equal(
  generateNextStudentCanonicalCode({
    countryCode: "CD",
    schoolInitials: "IN",
    year: 2026,
    existingCodes: [],
  }),
  "CD-IN-EL-26-001",
);
assert.equal(
  generateNextStudentCanonicalCode({
    countryCode: "CD",
    schoolInitials: "IN",
    year: 2026,
    existingCodes: ["CD-IN-EL-26-001", "CD-IN-EL-26-003", "ELE-0001"],
  }),
  "CD-IN-EL-26-004",
);
assert.notEqual(
  generateNextStudentCanonicalCode({ countryCode: "CD", schoolInitials: "IN", year: 2026, existingCodes: [] }),
  generateNextStudentCanonicalCode({ countryCode: "BI", schoolInitials: "IN", year: 2026, existingCodes: [] }),
);

assert.deepEqual(
  resolveSchoolIdentityContext({ loginCode: "CD-IN-26-001" }),
  { countryCode: "CD", schoolInitials: "IN" },
);
assert.deepEqual(
  resolveSchoolIdentityContext({ name: "Institut Nuru", school_code: "CD-2026-0001" }),
  { countryCode: "CD", schoolInitials: "IN" },
);

assert.throws(
  () => formatStudentCanonicalCode({ countryCode: "CD", schoolInitials: "IN", year: 2026, sequence: 1000 }),
  (error) => error.code === "STUDENT_SEQUENCE_EXHAUSTED",
);

console.log("studentCanonicalIdentifier.test.js OK");
