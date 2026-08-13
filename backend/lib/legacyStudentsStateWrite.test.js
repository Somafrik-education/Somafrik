"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEGACY_STUDENTS_STATE_WRITE_CODE,
  stripLegacyStudentsStateWrite,
} = require("./legacyStudentsStateWrite");

test("rejette students seul et retire la clé du corps défensif", () => {
  const result = stripLegacyStudentsStateWrite({ students: [{ studentCode: "ELE-CD-0001-0001-000001" }] });
  assert.equal(result.rejectLegacyStudentsWrite, true);
  assert.equal(result.strippedStudents, true);
  assert.deepEqual(result.body, {});
  assert.equal(LEGACY_STUDENTS_STATE_WRITE_CODE, "LEGACY_STUDENTS_STATE_WRITE_FORBIDDEN");
});

test("rejette toute présence de students, quelle que soit la valeur", () => {
  for (const value of [[], null, undefined, false, "legacy"]) {
    const result = stripLegacyStudentsStateWrite({ students: value, users: [{ id: "USER-SENTINEL" }] });
    assert.equal(result.rejectLegacyStudentsWrite, true);
    assert.equal(Object.prototype.hasOwnProperty.call(result.body, "students"), false);
    assert.deepEqual(result.body.users, [{ id: "USER-SENTINEL" }]);
  }
});

test("rejette un PUT mixte ou snapshot sans altérer les autres clés", () => {
  const result = stripLegacyStudentsStateWrite({
    students: [{ id: "STUDENT-HACK" }],
    users: [{ id: "USER-SENTINEL" }],
    subscriptions: [{ id: "SUB-SENTINEL" }],
  });
  assert.equal(result.rejectLegacyStudentsWrite, true);
  assert.deepEqual(result.body, {
    users: [{ id: "USER-SENTINEL" }],
    subscriptions: [{ id: "SUB-SENTINEL" }],
  });
});

test("laisse passer un corps sans students", () => {
  const body = { users: [{ id: "USER-OK" }] };
  const result = stripLegacyStudentsStateWrite(body);
  assert.equal(result.rejectLegacyStudentsWrite, false);
  assert.equal(result.strippedStudents, false);
  assert.equal(result.body, body);
});
