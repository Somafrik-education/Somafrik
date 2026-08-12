"use strict";

const assert = require("node:assert/strict");
const {
  generateNextStudentCode,
  formatStudentCode,
  studentCodePrefix,
} = require("./studentCodeGeneration");

assert.equal(
  generateNextStudentCode("CD-2026-0001", ["ELE-CD-0001-0001-000003"]),
  "ELE-CD-0001-0001-000004",
);
assert.equal(generateNextStudentCode("CD-2026-0001", []), "ELE-CD-0001-0001-000001");
assert.equal(generateNextStudentCode("CD-2026-0002", []), "ELE-CD-0002-0001-000001");
assert.notEqual(
  formatStudentCode("CD-2026-0001", 1),
  formatStudentCode("CD-2026-0002", 1),
);

// Collision critique : même n° d'établissement, pays différents.
assert.equal(formatStudentCode("CD-2026-0001", 1), "ELE-CD-0001-0001-000001");
assert.equal(formatStudentCode("BI-2026-0001", 1), "ELE-BI-0001-0001-000001");
assert.notEqual(
  formatStudentCode("CD-2026-0001", 1),
  formatStudentCode("BI-2026-0001", 1),
);
assert.notEqual(
  studentCodePrefix("CD-2026-0001"),
  studentCodePrefix("BI-2026-0001"),
);
assert.notEqual(
  generateNextStudentCode("CD-2026-0001", []),
  generateNextStudentCode("BI-2026-0001", []),
);

// Poursuite de séquence depuis un matricule legacy sans pays.
assert.equal(
  generateNextStudentCode("CD-2026-0001", ["ELE-0001-0001-000007"]),
  "ELE-CD-0001-0001-000008",
);

console.log("studentCodeGeneration.test.js: OK");
