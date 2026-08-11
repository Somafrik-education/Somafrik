"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  generateClassCode,
  validateCreateClassInput,
  validateUpdateClassInput,
  requireClassCodeParam,
} = require("./classesManagement");

test("generateClassCode produces immutable CLS-* codes", () => {
  const code = generateClassCode("SCH-001");
  assert.match(code, /^CLS-SCH-001-[A-Z0-9]+$/);
  assert.ok(code.length <= 64);
});

test("validateCreateClassInput accepts a valid payload", () => {
  const input = validateCreateClassInput(
    {
      name: "6ème A",
      academicYearName: "2025-2026",
      level: "6ème",
      section: "A",
      status: "active",
    },
    "SCH-001",
  );
  assert.deepEqual(input, {
    schoolCode: "SCH-001",
    name: "6ème A",
    academicYearName: "2025-2026",
    level: "6ème",
    section: "A",
    status: "active",
  });
});

test("validateCreateClassInput rejects client-provided classCode and bad status", () => {
  assert.throws(
    () => validateCreateClassInput({ name: "A", academicYearName: "2025-2026", classCode: "X" }, "SCH-001"),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () =>
      validateCreateClassInput(
        { name: "A", academicYearName: "2025-2026", status: "Active" },
        "SCH-001",
      ),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateCreateClassInput({ academicYearName: "2025-2026" }, "SCH-001"),
    (error) => error.statusCode === 400,
  );
});

test("validateCreateClassInput rejects cross-school body schoolCode", () => {
  assert.throws(
    () =>
      validateCreateClassInput(
        { name: "A", academicYearName: "2025-2026", schoolCode: "OTHER" },
        "SCH-001",
      ),
    (error) => error.statusCode === 403,
  );
});

test("validateUpdateClassInput allows name/level/section/status only", () => {
  const patch = validateUpdateClassInput({ name: "5ème B", status: "inactive" });
  assert.deepEqual(patch, { name: "5ème B", status: "inactive" });
  assert.throws(
    () => validateUpdateClassInput({ classCode: "CLS-1" }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateUpdateClassInput({ academicYearName: "2026-2027" }),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateUpdateClassInput({}),
    (error) => error.statusCode === 400,
  );
});

test("requireClassCodeParam rejects empty values", () => {
  assert.equal(requireClassCodeParam("CLS-1"), "CLS-1");
  assert.throws(() => requireClassCodeParam(""), (error) => error.statusCode === 400);
});
