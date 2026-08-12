"use strict";

const assert = require("node:assert/strict");
const {
  selectActiveTeacherAssignments,
  enrichTeacherUserWithActiveAssignments,
  resolveRecordedAssignmentStatus,
} = require("./teacherSessionAssignments");

function testMissingStatusFailClosed() {
  assert.equal(resolveRecordedAssignmentStatus({ classCode: "CLS-1" }), undefined);
  assert.equal(resolveRecordedAssignmentStatus({ status: "active" }), "active");
  assert.equal(resolveRecordedAssignmentStatus({ status: "inactive" }), "inactive");

  const selected = selectActiveTeacherAssignments([
    { classCode: "CLS-1", className: "6ème A" },
    { classCode: "CLS-2", className: "6ème A", status: "inactive" },
    { classCode: "CLS-3", className: "6ème A", status: "active" },
  ]);
  assert.deepEqual(
    selected.map((row) => row.classCode),
    ["CLS-3"],
  );
}

function testEnrichmentDoesNotDefaultActive() {
  const state = {
    teachers: [
      {
        id: "T-TEST",
        userId: "USER-T-TEST",
        identifier: "ENS-TEST",
        assignments: [
          { className: "6ème A", classCode: "CLS-A", course: "Math" },
          { className: "5ème B", classCode: "CLS-B", course: "Math", status: "inactive" },
        ],
      },
    ],
    assignments: [],
  };
  const enriched = enrichTeacherUserWithActiveAssignments(
    {
      id: "USER-T-TEST",
      identifier: "ENS-TEST",
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
    },
    state,
  );
  assert.deepEqual(enriched.assignments, []);
  assert.deepEqual(enriched.assignedClassCodes, []);
}

function testEnrichmentKeepsExplicitActive() {
  const state = {
    teachers: [
      {
        id: "T-TEST",
        userId: "USER-T-TEST",
        identifier: "ENS-TEST",
        assignments: [
          { className: "6ème A", classCode: "CLS-A", course: "Math", status: "active" },
        ],
      },
    ],
    assignments: [],
  };
  const enriched = enrichTeacherUserWithActiveAssignments(
    {
      id: "USER-T-TEST",
      identifier: "ENS-TEST",
      role: "Enseignant",
      schoolCode: "CD-2026-0001",
    },
    state,
  );
  assert.equal(enriched.assignments.length, 1);
  assert.equal(enriched.assignedClassCodes[0], "CLS-A");
}

function main() {
  testMissingStatusFailClosed();
  testEnrichmentDoesNotDefaultActive();
  testEnrichmentKeepsExplicitActive();
  console.log("teacherSessionAssignments.test.js: OK");
}

main();
