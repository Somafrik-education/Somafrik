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

test("rejette toute présence de schools, y compris un PUT mixte", () => {
  const mixedStudents = stripLegacySchoolsStateWrite(
    { schools: [{ code: "CD-2026-0001" }], students: [{ id: "s1" }], academicConfigs: { X: {} } },
    ENTITY_KEYS,
  );
  assert.equal(mixedStudents.rejectLegacySchoolsWrite, true);
  assert.equal(mixedStudents.strippedSchools, true);
  assert.equal(Object.prototype.hasOwnProperty.call(mixedStudents.body, "schools"), false);

  const mixedUsers = stripLegacySchoolsStateWrite(
    { schools: [{ code: "CD-HACK" }], users: [{ id: "USER-SENTINEL" }] },
    [...ENTITY_KEYS, "users", "subscriptions"],
  );
  assert.equal(mixedUsers.rejectLegacySchoolsWrite, true);

  const mixedSubscriptions = stripLegacySchoolsStateWrite(
    { schools: [{ code: "CD-HACK" }], subscriptions: [{ id: "SUB-SENTINEL" }] },
    [...ENTITY_KEYS, "users", "subscriptions"],
  );
  assert.equal(mixedSubscriptions.rejectLegacySchoolsWrite, true);

  const snapshot = stripLegacySchoolsStateWrite(
    { schools: [{ code: "CD-2026-0001" }], users: [{ id: "u1" }], subscriptions: [{ id: "s1" }] },
    [...ENTITY_KEYS, "users", "subscriptions"],
  );
  assert.equal(snapshot.rejectLegacySchoolsWrite, true);
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
