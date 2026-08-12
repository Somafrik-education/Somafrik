"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  stripLegacyClassesStateWrite,
  LEGACY_CLASSES_STATE_WRITE_CODE,
} = require("./legacyClassesStateWrite");

const ENTITY_KEYS = ["classes", "students", "teachers", "courses"];

test("rejette une écriture state limitée aux classes", () => {
  const result = stripLegacyClassesStateWrite({ classes: [{ id: "c1" }] }, ENTITY_KEYS);
  assert.equal(result.rejectLegacyClassesWrite, true);
  assert.equal(result.strippedClasses, true);
  assert.deepEqual(result.body, {});
});

test("retire classes d’un PUT multi-entités sans rejeter", () => {
  const result = stripLegacyClassesStateWrite(
    { classes: [{ id: "c1" }], students: [{ id: "s1" }], academicConfigs: { X: {} } },
    ENTITY_KEYS,
  );
  assert.equal(result.rejectLegacyClassesWrite, false);
  assert.equal(result.strippedClasses, true);
  assert.deepEqual(result.body, {
    students: [{ id: "s1" }],
    academicConfigs: { X: {} },
  });
});

test("laisse passer un corps sans classes", () => {
  const body = { teachers: [{ id: "t1" }] };
  const result = stripLegacyClassesStateWrite(body, ENTITY_KEYS);
  assert.equal(result.rejectLegacyClassesWrite, false);
  assert.equal(result.strippedClasses, false);
  assert.equal(result.body, body);
});

test("expose le code d’erreur stable", () => {
  assert.equal(LEGACY_CLASSES_STATE_WRITE_CODE, "LEGACY_CLASSES_STATE_WRITE_FORBIDDEN");
});
