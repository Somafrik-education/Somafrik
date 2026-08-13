"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateAssignmentInput } = require("./teacherAssignmentsManagement");

test("normalise les alias UI d'affectation", () => {
  assert.deepEqual(validateAssignmentInput({
    teacherId: "ENS-0001",
    className: "6ème A",
    course: "Mathématiques",
  }), {
    teacherCode: "ENS-0001",
    classRef: "6ème A",
    subjectRef: "Mathématiques",
    assignmentRole: "primary",
    present: { teacherCode: true, classRef: true, subjectRef: true, assignmentRole: false },
  });
});

test("rejette les champs de périmètre fournis par le client", () => {
  assert.throws(
    () => validateAssignmentInput({
      schoolCode: "CG-ATTACK",
      teacherId: "ENS-1",
      className: "6A",
      subject: "Maths",
    }),
    (error) => error.statusCode === 400 && error.code === "ASSIGNMENT_TENANT_FIELD_FORBIDDEN",
  );
});

test("rejette une affectation incomplète", () => {
  assert.throws(
    () => validateAssignmentInput({ teacherId: "ENS-1", className: "6A" }),
    (error) => error.code === "ASSIGNMENT_FIELDS_REQUIRED",
  );
});
