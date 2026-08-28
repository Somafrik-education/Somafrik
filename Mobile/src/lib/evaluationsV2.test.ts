/**
 * LOT 2 — contrat Mobile notes / évaluations V2.
 *   npx tsx Mobile/src/lib/evaluationsV2.test.ts
 */
import assert from "node:assert/strict";
import {
  buildCreateEvaluationPayload,
  buildSaveNotePayload,
  buildValidateEvaluationPatch,
  canonicalPeriodsFromConfig,
  canonicalWeightedAverage,
  evaluationAllowsGradeEntry,
  fromEvaluationStatus,
  gradesForEvaluation,
  isDraftOrOpenEvaluationStatus,
  isPublishedEvaluationStatus,
  isValidatedEvaluationStatus,
  normalizeEvaluation,
  normalizeGrade,
  notesForStudent,
  rosterStudentsForEvaluation,
  stripEvaluationClientScope,
  teacherCreatePayloadContainsForbiddenFields,
  validateGradeValue,
  gradeSaveActorScope,
  EVALUATIONS_V2_MISSING_TEACHER,
} from "./evaluationsV2";

function run() {
  assert.equal(fromEvaluationStatus("locked"), "Validée");
  assert.equal(fromEvaluationStatus("draft"), "Brouillon");
  assert.equal(fromEvaluationStatus("open"), "Ouverte");
  assert.equal(fromEvaluationStatus("published"), "Publiée");
  assert.equal(isValidatedEvaluationStatus("Validée"), true);
  assert.equal(isValidatedEvaluationStatus("Brouillon"), false);
  assert.equal(isPublishedEvaluationStatus("Publiée"), true);
  assert.equal(isDraftOrOpenEvaluationStatus("Ouverte"), true);

  const created = buildCreateEvaluationPayload({
    classId: "class-1",
    subject: "Mathématiques",
    subjectCode: "MATH",
    period: "Trimestre 1",
    evaluationTypeId: "type-1",
    date: "2026-03-12",
    scale: 20,
    title: "Devoir 1",
  });
  assert.equal(created.classId, "class-1");
  assert.equal(created.evaluationTypeId, "type-1");
  assert.equal(created.teacherId, undefined);
  assert.equal(created.status, undefined);
  assert.equal(created.schoolCode, undefined);
  assert.equal(teacherCreatePayloadContainsForbiddenFields(created), false);
  assert.equal(
    teacherCreatePayloadContainsForbiddenFields({ ...created, teacherId: "TEACHERS-2" }),
    true,
  );
  assert.equal(
    teacherCreatePayloadContainsForbiddenFields({ ...created, status: "Validée" }),
    true,
  );

  const stripped = stripEvaluationClientScope({
    classId: "c1",
    teacherId: "TEACHERS-9",
    schoolCode: "CD-2026",
    evaluationTypeId: "t1",
  });
  assert.equal(stripped.teacherId, undefined);
  assert.equal(stripped.schoolCode, undefined);
  assert.equal(stripped.classId, "c1");

  const validated = buildValidateEvaluationPatch();
  assert.equal(validated.status, "Validée");

  const evaluation = normalizeEvaluation({
    id: "EVAL-1",
    classId: "class-a",
    classCode: "6A",
    className: "6ème A",
    subject: "Mathématiques",
    termId: "term-1",
    period: "Trimestre 1",
    evaluationTypeId: "type-1",
    status: "locked",
    scale: 20,
    title: "Devoir",
    date: "12-03-2026",
  });
  assert.equal(evaluation.evaluationId, "EVAL-1");
  assert.equal(evaluation.classId, "class-a");
  assert.equal(evaluation.status, "Validée");
  assert.equal(evaluationAllowsGradeEntry(evaluation), true);
  assert.equal(
    evaluationAllowsGradeEntry({ ...evaluation, status: "Brouillon", canonicalStatus: "draft" }),
    false,
  );

  assert.throws(
    () =>
      buildSaveNotePayload({
        evaluationId: "",
        studentId: "STU-1",
        scale: 20,
        value: 12,
      }),
    /evaluationId/,
  );

  const notePayload = buildSaveNotePayload({
    evaluationId: "EVAL-1",
    studentId: "STU-1",
    scale: 20,
    value: 14,
    className: "6ème A",
    subject: "Mathématiques",
  });
  assert.equal(notePayload.evaluationId, "EVAL-1");
  assert.equal(notePayload.teacherId, undefined);
  assert.equal(notePayload.value, 14);

  const adminNote = buildSaveNotePayload({
    evaluationId: "EVAL-1",
    studentId: "STU-1",
    scale: 20,
    value: 14,
    teacherId: "ENS-0001",
  });
  assert.equal(adminNote.teacherId, "ENS-0001");
  assert.deepEqual(gradeSaveActorScope(true, { teacherId: "ENS-0001" }), {});
  assert.deepEqual(gradeSaveActorScope(false, { teacherId: "ENS-0001" }), { teacherId: "ENS-0001" });
  assert.throws(
    () => gradeSaveActorScope(false, { teacherId: "" }),
    (error: Error) => error.message === EVALUATIONS_V2_MISSING_TEACHER,
  );

  assert.equal(validateGradeValue("21", 20).ok, false);
  assert.equal(validateGradeValue("-1", 20).ok, false);
  assert.equal(validateGradeValue("abc", 20).ok, false);
  assert.equal(validateGradeValue("12,5", 20).ok, true);

  const roster = rosterStudentsForEvaluation(
    [
      { id: "s1", name: "Ada", classId: "class-a", classCode: "6A" },
      { id: "s2", name: "Eve", classId: "class-b", classCode: "6B" },
      { id: "s3", name: "Archived", classId: "class-a", archived: true },
    ],
    evaluation,
  );
  assert.deepEqual(
    roster.map((row) => row.id),
    ["s1"],
  );

  const naiveAverageForbidden = canonicalWeightedAverage([
    normalizeGrade({ evaluationId: "e1", studentId: "s1", value: 8, scale: 10, gradeStatus: "graded" }),
    normalizeGrade({ evaluationId: "e2", studentId: "s1", value: 12, scale: 20, gradeStatus: "graded" }),
  ]);
  assert.equal(naiveAverageForbidden.available, true);
  assert.equal(Number(naiveAverageForbidden.average?.toFixed(1)), 14.0);

  const emptyAverage = canonicalWeightedAverage([]);
  assert.equal(emptyAverage.available, false);
  assert.equal(emptyAverage.average, null);

  const absentAverage = canonicalWeightedAverage([
    normalizeGrade({ evaluationId: "e1", studentId: "s1", value: null, scale: 20, gradeStatus: "absent" }),
  ]);
  assert.equal(absentAverage.available, false);

  const grades = [
    normalizeGrade({ id: "n1", evaluationId: "EVAL-1", studentId: "s1", value: 12, scale: 20 }),
    normalizeGrade({ id: "n2", evaluationId: "EVAL-2", studentId: "s1", value: 15, scale: 20 }),
    normalizeGrade({ id: "n3", evaluationId: "EVAL-1", studentId: "s2", value: 9, scale: 20 }),
  ];
  assert.equal(gradesForEvaluation(grades, "EVAL-1").length, 2);
  assert.equal(notesForStudent(grades, "s1").length, 2);

  const periods = canonicalPeriodsFromConfig([
    { id: "p1", name: "Trimestre 1", active: true },
    { name: "Trimestre 2", active: false },
  ]);
  assert.equal(periods[0]?.id, "p1");
  assert.equal(periods.length, 2);
  assert.deepEqual(canonicalPeriodsFromConfig([]), []);

  console.log("OK: evaluationsV2 unit tests");
}

run();
