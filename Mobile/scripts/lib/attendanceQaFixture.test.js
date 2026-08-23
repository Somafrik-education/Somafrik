"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hasAttendanceQaFixture,
  maestroAttendanceEnvFrom,
  validateAttendanceQaFixture,
} = require("./attendanceQaFixture");

const valid = {
  SOMAFRIK_E2E_ATTENDANCE_CLASS: "QA-APPEL-6A",
  SOMAFRIK_E2E_ATTENDANCE_STUDENT_A: "QA-ATT-A1",
  SOMAFRIK_E2E_ATTENDANCE_STUDENT_B: "QA-ATT-B1",
  SOMAFRIK_E2E_ATTENDANCE_STUDENT_C: "QA-ATT-C1",
  SOMAFRIK_E2E_ATTENDANCE_STUDENT_D: "QA-ATT-D1",
};

test("fixture manquant → BLOCKED, jamais ok", () => {
  const result = validateAttendanceQaFixture({});
  assert.equal(result.ok, false);
  assert.equal(result.code, "MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE");
  assert.equal(hasAttendanceQaFixture({}), false);
});

test("classe métier refusée", () => {
  const result = validateAttendanceQaFixture({
    ...valid,
    SOMAFRIK_E2E_ATTENDANCE_CLASS: "6ème A",
  });
  assert.equal(result.ok, false);
});

test("élève hors préfixe QA-ATT refusé", () => {
  const result = validateAttendanceQaFixture({
    ...valid,
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_A: "STU-NURU-1",
  });
  assert.equal(result.ok, false);
});

test("fixture QA valide expose slug + 4 élèves", () => {
  assert.equal(hasAttendanceQaFixture(valid), true);
  const env = maestroAttendanceEnvFrom(valid);
  assert.equal(env.SOMAFRIK_E2E_ATTENDANCE_CLASS_SLUG, "qa-appel-6a");
  assert.equal(env.SOMAFRIK_E2E_ATTENDANCE_STUDENT_A, "QA-ATT-A1");
});
