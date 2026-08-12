"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  stripLegacyStudentsStateWrite,
  LEGACY_STUDENTS_STATE_WRITE_CODE,
} = require("./legacyStudentsStateWrite");

const ENTITY_KEYS = ["classes", "students", "teachers", "courses"];

test("rejette une écriture state limitée aux élèves", () => {
  const result = stripLegacyStudentsStateWrite({ students: [{ id: "s1" }] }, ENTITY_KEYS);
  assert.equal(result.rejectLegacyStudentsWrite, true);
  assert.equal(result.strippedStudents, true);
  assert.deepEqual(result.body, {});
});

test("retire students d’un PUT multi-entités sans rejeter", () => {
  const result = stripLegacyStudentsStateWrite(
    { students: [{ id: "s1" }], teachers: [{ id: "t1" }], academicConfigs: { X: {} } },
    ENTITY_KEYS,
  );
  assert.equal(result.rejectLegacyStudentsWrite, false);
  assert.equal(result.strippedStudents, true);
  assert.deepEqual(result.body, {
    teachers: [{ id: "t1" }],
    academicConfigs: { X: {} },
  });
});

test("laisse passer un corps sans students", () => {
  const body = { teachers: [{ id: "t1" }] };
  const result = stripLegacyStudentsStateWrite(body, ENTITY_KEYS);
  assert.equal(result.rejectLegacyStudentsWrite, false);
  assert.equal(result.strippedStudents, false);
  assert.equal(result.body, body);
});

test("expose le code d’erreur stable", () => {
  assert.equal(LEGACY_STUDENTS_STATE_WRITE_CODE, "LEGACY_STUDENTS_STATE_WRITE_FORBIDDEN");
});
