/**
 * HOTFIX-PRE-E1-02 — Helpers sync enseignants / affectations.
 */
const assert = require("assert");
const {
  resolveStableTeacherCode,
  validateTeacherSyncRecord,
  validateAssignmentSyncRecord,
  shouldSyncTeachersFromPayload,
  shouldSyncAssignmentsFromPayload,
  mergePreE1SyncAck,
} = require("./pedagogyStaffBoPersistence");

function run() {
  // HOTFIX-PRE-E1-02B : id TEACHERS-* canonique même si publicId ENS-* présent.
  assert.strictEqual(
    resolveStableTeacherCode({ id: "TEACHERS-1", publicId: "CD-2026-0051-ENS-0001" }),
    "TEACHERS-1",
  );
  assert.strictEqual(resolveStableTeacherCode({ id: "TEACHERS-1" }), "TEACHERS-1");
  assert.strictEqual(
    resolveStableTeacherCode({ id: "TEACHER-9", publicId: "CD-2026-0051-ENS-0001" }),
    "TEACHER-9",
  );
  assert.strictEqual(resolveStableTeacherCode({ publicId: "PUB-T" }), "PUB-T");

  const okTeacher = validateTeacherSyncRecord({
    id: "TEACHERS-1",
    schoolCode: "sch-a",
  });
  assert.strictEqual(okTeacher.ok, true);
  assert.strictEqual(okTeacher.schoolCode, "SCH-A");

  assert.strictEqual(validateTeacherSyncRecord({ id: "T1" }).ok, false);
  assert.strictEqual(validateTeacherSyncRecord({ schoolCode: "SCH-A" }).ok, false);

  const okAssign = validateAssignmentSyncRecord({
    teacherId: "TEACHERS-1",
    className: "6e A",
    subject: "Mathématiques",
    schoolCode: "SCH-A",
  });
  assert.strictEqual(okAssign.ok, true);
  assert.strictEqual(okAssign.assignmentKey, "TEACHERS-1|6e A|Mathématiques");

  assert.strictEqual(
    validateAssignmentSyncRecord({
      teacherId: "TEACHERS-1",
      className: "6e A",
      schoolCode: "SCH-A",
    }).ok,
    false,
  );

  assert.strictEqual(shouldSyncTeachersFromPayload({ teachers: [] }), true);
  assert.strictEqual(shouldSyncAssignmentsFromPayload({ notes: [] }), false);

  const ack = mergePreE1SyncAck(
    { accepted: { students: ["S1"], enrollments: ["S1"] }, rejected: [] },
    { accepted: { teachers: ["T1"], assignments: ["T1|6e A|Math"] }, rejected: [] },
    { accepted: { evaluations: ["E1"], notes: ["N1"] }, rejected: [] },
  );
  assert.deepStrictEqual(
    ack.accepted.map((row) => `${row.entity}:${row.id}`),
    [
      "students:S1",
      "enrollments:S1",
      "teachers:T1",
      "assignments:T1|6e A|Math",
      "evaluations:E1",
      "notes:N1",
    ],
  );

  console.log("pedagogyStaffBoPersistence.test.js : OK");
}

run();
