"use strict";

const assert = require("node:assert/strict");
const { generateNextStudentCode } = require("./studentCodeGeneration");

assert.equal(
  generateNextStudentCode("CD-2026-0001", ["ELE-CD-2026-000003"]),
  "ELE-CD-2026-000004",
);
assert.equal(
  generateNextStudentCode("CD-2026-0001", []),
  "ELE-CD-2026-000001",
);

console.log("studentCodeGeneration.test.js: OK");
