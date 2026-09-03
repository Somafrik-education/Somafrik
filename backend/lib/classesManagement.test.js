"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  generateClassCode,
  validateCreateClassInput,
  validateUpdateClassInput,
  composeClassDisplayName,
  CLASS_WRITE_ERROR,
} = require("./classesManagement");

test("generateClassCode produces immutable CLS-* codes", () => {
  const code = generateClassCode("SCH-001");
  assert.match(code, /^CLS-SCH-001-[A-Z0-9]+$/);
  assert.ok(code.length <= 64);
});

test("composeClassDisplayName joint niveau, filière et série métier", () => {
  assert.equal(
    composeClassDisplayName({ levelName: "4ème", streamName: "Scientifique", groupCode: "A" }),
    "4ème Scientifique A",
  );
  assert.equal(composeClassDisplayName({ levelName: "6ème", streamName: null, groupCode: "A" }), "6ème A");
  assert.equal(
    composeClassDisplayName({ levelName: "1ère Primaire", streamName: null, groupCode: "A" }),
    "1ère Primaire A",
  );
  assert.equal(
    composeClassDisplayName({
      levelName: "1ère Humanité",
      streamName: "Scientifique",
      groupCode: "A",
    }),
    "1ère Humanité Scientifique A",
  );
  assert.equal(
    composeClassDisplayName({
      levelName: "2ème Humanité",
      streamName: "Commerciale et Gestion",
      groupCode: "B",
    }),
    "2ème Humanité Commerciale et Gestion B",
  );
});

test("validateCreateClassInput n'accepte plus le texte libre", () => {
  assert.throws(
    () =>
      validateCreateClassInput(
        { name: "Toto", academicYearName: "2025-2026", level: "NIVEAU INVENTÉ", section: "XYZ" },
        "SCH-001",
      ),
    (error) => error.statusCode === 400 && error.code === CLASS_WRITE_ERROR.FREE_TEXT_FORBIDDEN,
  );
});

test("validateCreateClassInput accepte le contrat structurel", () => {
  const input = validateCreateClassInput(
    {
      academicYearId: "ay-1",
      levelId: "level-1",
      streamId: "stream-1",
      groupId: "group-1",
      status: "active",
    },
    "SCH-001",
  );
  assert.deepEqual(input, {
    schoolCode: "SCH-001",
    academicYearId: "ay-1",
    levelId: "level-1",
    streamId: "stream-1",
    groupId: "group-1",
    status: "active",
  });
});

test("validateCreateClassInput exige toujours groupId (PR-1A ne le rend pas facultatif)", () => {
  assert.throws(
    () => validateCreateClassInput({ academicYearId: "ay-1", levelId: "level-1" }, "SCH-001"),
    (error) => error.statusCode === 400 && /groupId/.test(error.message),
  );
  assert.throws(
    () => validateCreateClassInput({ academicYearId: "ay-1", levelId: "level-1", groupId: null }, "SCH-001"),
    (error) => error.statusCode === 400 && /groupId/.test(error.message),
  );
});

test("validateCreateClassInput permet une filière absente", () => {
  const input = validateCreateClassInput(
    { academicYearId: "ay-1", levelId: "level-1", groupId: "group-b" },
    "SCH-001",
  );
  assert.equal(input.streamId, null);
  assert.equal(input.groupId, "group-b");
});

test("validateCreateClassInput rejects client-provided classCode, groupCode and bad status", () => {
  assert.throws(
    () =>
      validateCreateClassInput(
        { academicYearId: "ay-1", levelId: "l1", groupId: "g1", classCode: "X" },
        "SCH-001",
      ),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () =>
      validateCreateClassInput(
        { academicYearId: "ay-1", levelId: "l1", groupCode: "XYZ" },
        "SCH-001",
      ),
    (error) => error.statusCode === 400 && error.code === CLASS_WRITE_ERROR.FREE_TEXT_FORBIDDEN,
  );
  assert.throws(
    () =>
      validateCreateClassInput(
        { academicYearId: "ay-1", levelId: "l1", groupId: "g1", status: "Active" },
        "SCH-001",
      ),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => validateCreateClassInput({ academicYearId: "ay-1" }, "SCH-001"),
    (error) => error.statusCode === 400,
  );
});

test("validateCreateClassInput rejects cross-school body schoolCode", () => {
  assert.throws(
    () =>
      validateCreateClassInput(
        { academicYearId: "ay-1", levelId: "l1", groupId: "g1", schoolCode: "OTHER" },
        "SCH-001",
      ),
    (error) => error.statusCode === 403,
  );
});

test("validateUpdateClassInput permet status et IDs, refuse le nom", () => {
  const patch = validateUpdateClassInput({ status: "inactive" });
  assert.deepEqual(patch, { status: "inactive" });
  assert.throws(
    () => validateUpdateClassInput({ name: "5ème B" }),
    (error) => error.statusCode === 400 && error.code === CLASS_WRITE_ERROR.FREE_TEXT_FORBIDDEN,
  );
  assert.throws(
    () => validateUpdateClassInput({ academicYearId: "ay-2" }),
    (error) => error.statusCode === 400,
  );
});
