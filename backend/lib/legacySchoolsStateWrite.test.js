"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  stripLegacySchoolsStateWrite,
  LEGACY_SCHOOLS_STATE_WRITE_CODE,
} = require("./legacySchoolsStateWrite");

const ENTITY_KEYS = ["schools", "students", "teachers", "courses", "classes"];

test("rejette une écriture state limitée aux établissements", () => {
  const result = stripLegacySchoolsStateWrite({ schools: [{ code: "CD-2026-0001" }] }, ENTITY_KEYS);
  assert.equal(result.rejectLegacySchoolsWrite, true);
  assert.equal(result.strippedSchools, true);
  assert.deepEqual(result.body, {});
});

test("retire schools d’un PUT multi-entités sans rejeter", () => {
  const result = stripLegacySchoolsStateWrite(
    { schools: [{ code: "CD-2026-0001" }], students: [{ id: "s1" }], academicConfigs: { X: {} } },
    ENTITY_KEYS,
  );
  assert.equal(result.rejectLegacySchoolsWrite, false);
  assert.equal(result.strippedSchools, true);
  assert.deepEqual(result.body, {
    students: [{ id: "s1" }],
    academicConfigs: { X: {} },
  });
});

test("laisse passer un corps sans schools", () => {
  const body = { teachers: [{ id: "t1" }] };
  const result = stripLegacySchoolsStateWrite(body, ENTITY_KEYS);
  assert.equal(result.rejectLegacySchoolsWrite, false);
  assert.equal(result.strippedSchools, false);
  assert.equal(result.body, body);
});

test("expose le code d’erreur stable", () => {
  assert.equal(LEGACY_SCHOOLS_STATE_WRITE_CODE, "LEGACY_SCHOOLS_STATE_WRITE_FORBIDDEN");
});
