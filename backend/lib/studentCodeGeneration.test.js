"use strict";

const assert = require("node:assert/strict");
const {
  generateNextStudentCode,
  formatStudentCode,
} = require("./studentCodeGeneration");

assert.equal(
  generateNextStudentCode("CD-2026-0001", ["ELE-0001-0001-000003"]),
  "ELE-0001-0001-000004",
);
assert.equal(generateNextStudentCode("CD-2026-0001", []), "ELE-0001-0001-000001");
assert.equal(generateNextStudentCode("CD-2026-0002", []), "ELE-0002-0001-000001");
assert.notEqual(
  formatStudentCode("CD-2026-0001", 1),
  formatStudentCode("CD-2026-0002", 1),
);

console.log("studentCodeGeneration.test.js: OK");
