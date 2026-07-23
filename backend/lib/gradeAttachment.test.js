/**
 * HOTFIX-SYNC-04 — Codes métier notes.
 */
const assert = require("assert");
const { GradeErrors, mapGradeSyncError } = require("./gradeAttachment");

function run() {
  assert.strictEqual(GradeErrors.EVALUATION_MISSING("e1").code, "GRADE_ATTACHMENT_EVALUATION");
  assert.strictEqual(GradeErrors.STUDENT_MISSING("s1").code, "GRADE_ATTACHMENT_STUDENT");
  assert.strictEqual(GradeErrors.TEACHER_MISSING().code, "GRADE_ATTACHMENT_TEACHER");
  assert.strictEqual(GradeErrors.VERSION_CONFLICT().code, "GRADE_VERSION_CONFLICT");
  assert.strictEqual(GradeErrors.VERSION_CONFLICT().statusCode, 409);
  assert.strictEqual(GradeErrors.DUPLICATE().code, "GRADE_DUPLICATE");

  const dup = mapGradeSyncError({ code: "23505", message: "duplicate key value" });
  assert.strictEqual(dup.code, "GRADE_DUPLICATE");

  const check = mapGradeSyncError({
    code: "23514",
    message: 'new row violates check constraint "grades_status_score_coherence"',
  });
  assert.strictEqual(check.code, "GRADE_CONTRACT");

  const fkEval = mapGradeSyncError({
    code: "23503",
    message: "insert or update on table grades violates foreign key constraint",
    detail: "Key (evaluation_id)=(...) is not present in table evaluations",
  });
  assert.strictEqual(fkEval.code, "GRADE_ATTACHMENT_EVALUATION");

  const fkStudent = mapGradeSyncError({
    code: "23503",
    message: "foreign key",
    detail: "Key (student_id)=(...) is not present",
  });
  assert.strictEqual(fkStudent.code, "GRADE_ATTACHMENT_STUDENT");

  const opaque = mapGradeSyncError(new Error("boom sql"));
  assert.strictEqual(opaque.code, "GRADE_SYNC_FAILED");
  assert.strictEqual(opaque.statusCode, 400);

  const passthrough = mapGradeSyncError(GradeErrors.STUDENT_MISSING("x"));
  assert.strictEqual(passthrough.code, "GRADE_ATTACHMENT_STUDENT");

  console.log("gradeAttachment.test.js : OK");
}

run();
