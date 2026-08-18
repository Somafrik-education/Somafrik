"use strict";

const assert = require("node:assert/strict");
const {
  requestedClassIdentity,
  mergeAttendanceClassIdentity,
  activeEnrollmentMatchesRequestedClass,
  classRowMatchesRequestedIdentity,
} = require("./presencesAttendanceAuthz");
const { mapActiveAssignments } = require("../db/teachersRepository");
const { scopeClassStudentsForPrincipal } = require("./classStudentsAuthz");
const { BusinessError } = require("../services/authService");

function testRequestedClassIgnoresClassName() {
  const identity = requestedClassIdentity({
    className: "2ème A",
    classCode: "CLS-A",
    classId: "uuid-a",
  });
  assert.equal(identity.classCode, "CLS-A");
  assert.equal(identity.classId, "uuid-a");
  assert.equal(requestedClassIdentity({ className: "2ème A" }).classCode, "");
  assert.equal(requestedClassIdentity({ className: "2ème A" }).classId, "");
}

function testMergePrefersItemThenBatch() {
  const merged = mergeAttendanceClassIdentity(
    { classCode: "CLS-ITEM" },
    { classId: "uuid-batch", classCode: "CLS-BATCH", className: "Ignoré" },
  );
  assert.equal(merged.classCode, "CLS-ITEM");
  assert.equal(merged.classId, "uuid-batch");
}

function testEnrollmentMatchCases() {
  const enrollment = {
    classId: "uuid-a",
    classCode: "CLS-A",
    status: "active",
  };
  assert.equal(
    activeEnrollmentMatchesRequestedClass(enrollment, { classId: "uuid-a", classCode: "CLS-A" }),
    true,
  );
  assert.equal(
    activeEnrollmentMatchesRequestedClass(enrollment, { classId: "uuid-b", classCode: "CLS-B" }),
    false,
    "G — élève d'une autre classe",
  );
  assert.equal(
    activeEnrollmentMatchesRequestedClass({ ...enrollment, status: "archived" }, { classId: "uuid-a" }),
    false,
    "D — inscription inactive",
  );
  assert.equal(
    activeEnrollmentMatchesRequestedClass(enrollment, { className: "2ème A" }),
    true,
    "sans classId/classCode, l'inscription active suffit — le nom client n'est pas lu",
  );
}

function testClassRowConflict() {
  assert.equal(
    classRowMatchesRequestedIdentity(
      { id: "uuid-a", class_code: "CLS-A" },
      { classId: "uuid-a", classCode: "CLS-B" },
    ),
    false,
  );
}

function testCaseFAssignmentWithoutClassName() {
  const mapped = mapActiveAssignments(
    [
      {
        teacher_code: "ENS-1",
        class_id: "uuid-f",
        class_code: "CLS-F",
        class_name: "",
        subject_name: "",
        status: "active",
      },
    ],
    "ENS-1",
  );
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].classId, "uuid-f");
  assert.equal(mapped[0].classCode, "CLS-F");
  assert.equal(mapped[0].className, "");
}

function testCaseERosterDeniedWithoutAssignment() {
  assert.throws(
    () =>
      scopeClassStudentsForPrincipal(
        {
          role: "Enseignant",
          assignments: [{ classId: "uuid-other", classCode: "CLS-OTHER", status: "active" }],
        },
        { classId: "uuid-a", classCode: "CLS-A", className: "2ème A" },
        [{ id: "ELE-1", classId: "uuid-a", classCode: "CLS-A" }],
        () => undefined,
      ),
    (error) => error instanceof BusinessError && error.statusCode === 403,
  );
}

function main() {
  testRequestedClassIgnoresClassName();
  testMergePrefersItemThenBatch();
  testEnrollmentMatchCases();
  testClassRowConflict();
  testCaseFAssignmentWithoutClassName();
  testCaseERosterDeniedWithoutAssignment();
  console.log("presencesAttendanceAuthz.test.js: OK");
}

main();
