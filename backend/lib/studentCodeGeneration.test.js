"use strict";

const assert = require("node:assert/strict");
const {
  generateNextStudentCode,
  formatStudentCode,
  studentCodePrefix,
} = require("./studentCodeGeneration");

const nuru = { name: "Institut Nuru", login_code: "CD-IN-26-001" };
const nuruBi = { name: "Institut Nuru", login_code: "BI-IN-26-001" };
const lumumba = { name: "Lycée Lumumba", login_code: "CD-LL-26-001" };

assert.equal(generateNextStudentCode("CD-2026-0001", [], nuru), "CD-IN-EL-26-001");
assert.equal(
  generateNextStudentCode("CD-2026-0001", ["CD-IN-EL-26-003"], nuru),
  "CD-IN-EL-26-004",
);
assert.equal(formatStudentCode("CD-2026-0001", 1, nuru), "CD-IN-EL-26-001");
assert.equal(formatStudentCode("CD-2026-0002", 1, lumumba), "CD-LL-EL-26-001");
assert.notEqual(
  formatStudentCode("CD-2026-0001", 1, nuru),
  formatStudentCode("CD-2026-0002", 1, lumumba),
);

assert.equal(formatStudentCode("CD-2026-0001", 1, nuru), "CD-IN-EL-26-001");
assert.equal(formatStudentCode("BI-2026-0001", 1, nuruBi), "BI-IN-EL-26-001");
assert.notEqual(
  formatStudentCode("CD-2026-0001", 1, nuru),
  formatStudentCode("BI-2026-0001", 1, nuruBi),
);
assert.notEqual(studentCodePrefix("CD-2026-0001", nuru), studentCodePrefix("BI-2026-0001", nuruBi));
assert.notEqual(
  generateNextStudentCode("CD-2026-0001", [], nuru),
  generateNextStudentCode("BI-2026-0001", [], nuruBi),
);

assert.equal(isCanonical("CD-IN-EL-26-001"), true);

function isCanonical(value) {
  return /^[A-Z]{2}-[A-Z0-9]{2,5}-EL-[0-9]{2}-[0-9]{3}$/.test(value);
}

console.log("studentCodeGeneration.test.js: OK");
