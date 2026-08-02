"use strict";

const assert = require("assert");
const { auditTeacherDuplicates } = require("./teacherHistoricalDuplicateAudit");

function run() {
  const state = {
    teachers: [
      { id: "TEACHERS-canon", schoolCode: "S1", userId: "U1", contactId: "C1", identifier: "ENS-1" },
      { id: "TEACHER-legacy", schoolCode: "S1", userId: "U1", identifier: "ENS-1" },
      { id: "TEACHERS-a", schoolCode: "S1", contactId: "C2" },
      { id: "TEACHERS-b", schoolCode: "S1", contactId: "C2" },
      { id: "TEACHERS-h1", schoolCode: "S1", name: "Diallo", firstName: "Awa", birthDate: "2000-01-01", identifier: "ENS-3" },
      { id: "TEACHERS-h2", schoolCode: "S1", name: "Diallo", firstName: "Awa", birthDate: "2000-01-01", identifier: "ENS-4" },
      { id: "TEACHERS-orphan", schoolCode: "S1" },
    ],
    users: [{ id: "U1", teacherId: "TEACHERS-canon" }],
    contacts: [{ id: "C1", teacherId: "TEACHER-legacy" }],
    assignments: [{ id: "A1", teacherId: "TEACHER-legacy" }],
    notes: [{ id: "N1", authorId: "TEACHERS-canon" }],
    grades: [{ id: "G1", teacherId: "TEACHER-legacy" }],
    presences: [{ id: "P1", teacherId: "TEACHERS-canon" }],
    evaluations: [{ id: "E1", teacherId: "TEACHER-legacy" }],
    bulletins: [{ id: "B1", teacherId: "TEACHERS-canon" }],
  };
  const before = JSON.stringify(state);
  const report = auditTeacherDuplicates(state, { generatedAt: "2026-08-03T00:00:00.000Z", source: "test" });
  assert.strictEqual(JSON.stringify(state), before, "le scanner ne mute jamais le snapshot fourni");
  assert.strictEqual(report.totals.teachers, 7);
  assert.strictEqual(report.totals.safeDuplicateGroups, 1);
  assert.strictEqual(report.totals.safeDuplicateRecords, 1);
  assert.strictEqual(report.totals.ambiguousGroups, 1);
  assert.strictEqual(report.totals.homonymPossibleGroups, 1);
  assert.strictEqual(report.totals.orphanRecords, 1);
  const safe = report.groups.find((group) => group.classification === "SAFE_DUPLICATE");
  assert.strictEqual(safe.canonicalTeacherId, "TEACHERS-canon");
  assert.deepStrictEqual(report.reconciliationPlan[0], {
    duplicateTeacherId: "TEACHER-legacy",
    canonicalTeacherId: "TEACHERS-canon",
    referencesToMove: { users: 1, contacts: 1, assignments: 1, grades: 1, evaluations: 1 },
    referenceTotal: 5,
  });
  assert.strictEqual(report.dryRun.teacherCountBefore, 7);
  assert.strictEqual(report.dryRun.teacherCountAfter, 6);
  assert.strictEqual(report.dryRun.collectionCountsBefore.assignments, 1);
  assert.strictEqual(report.dryRun.collectionCountsAfter.assignments, 1);
  assert.strictEqual(report.dryRun.invariants.danglingReferencesAfterSimulation, 0);
  assert.ok(
    Object.entries(report.dryRun.invariants)
      .filter(([key]) => key !== "danglingReferencesAfterSimulation")
      .every(([, value]) => value === true),
  );
  const ambiguous = report.groups.find((group) => group.classification === "AMBIGUOUS");
  assert.strictEqual(ambiguous.canonicalTeacherId, null);
  assert.ok(!report.reconciliationPlan.some((item) => ambiguous.teacherIds.includes(item.duplicateTeacherId)));
  console.log("teacherHistoricalDuplicateAudit.test.js : OK");
}

run();
