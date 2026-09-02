/**
 * D3.6b — Contrat Notes : statuts, score/barème, unicité, calcul, publication.
 */
const assert = require("assert");
const { validateNoteWrite } = require("./dataIntegrityRules");
const {
  toEvaluationStatus,
  fromEvaluationStatus,
  toGradeStatus,
  validateGradeContract,
  validateEvaluationContract,
  weightedAverage,
  formatAverageForDisplay,
  isPublishedEvaluationStatus,
  pickCanonicalGradeRow,
} = require("./gradesCanonical");
const { assertNoteOptimisticLock, noteVersion, bumpNoteVersion } = require("./noteConcurrency");
const { GradeBookService } = require("../services/gradeBookService");

function baseState() {
  return {
    students: [
      {
        id: "STU-1",
        matricule: "MAT-1",
        schoolCode: "SCH-001",
        className: "6ème A",
        schoolStatus: "Inscrit",
      },
    ],
    evaluations: [
      {
        id: "EVAL-1",
        schoolCode: "SCH-001",
        className: "6ème A",
        subject: "Maths",
        scale: 20,
        coefficient: 2,
        status: "Validée",
        active: true,
      },
      {
        id: "EVAL-PUB",
        schoolCode: "SCH-001",
        className: "6ème A",
        subject: "Maths",
        scale: 20,
        coefficient: 1,
        status: "Publiée",
        active: true,
      },
    ],
    notes: [
      {
        id: "NOTE-1",
        studentId: "STU-1",
        schoolCode: "SCH-001",
        evaluationId: "EVAL-1",
        subject: "Maths",
        value: 12,
        scale: 20,
        gradeStatus: "Saisie",
      },
    ],
  };
}

function run() {
  // Statuts évaluation
  assert.strictEqual(toEvaluationStatus("Publiée"), "published");
  assert.strictEqual(toEvaluationStatus("Validée"), "locked");
  assert.strictEqual(fromEvaluationStatus("open"), "Ouverte");
  assert.ok(isPublishedEvaluationStatus("Publiée"));
  assert.ok(isPublishedEvaluationStatus("published"));
  assert.ok(!isPublishedEvaluationStatus("Ouverte"));

  // Contrat évaluation
  assert.strictEqual(
    validateEvaluationContract({ maxScore: 20, coefficient: 1, status: "open" }),
    null,
  );
  assert.ok(validateEvaluationContract({ maxScore: 0, coefficient: 1, status: "open" }));
  assert.ok(validateEvaluationContract({ maxScore: 20, coefficient: 0, status: "open" }));

  // Contrat note — graded / null statuses
  assert.strictEqual(
    validateGradeContract({ status: "graded", score: 14, maxScore: 20, coefficient: 1 }),
    null,
  );
  assert.ok(validateGradeContract({ status: "graded", score: null, maxScore: 20, coefficient: 1 }));
  assert.ok(validateGradeContract({ status: "absent", score: 0, maxScore: 20, coefficient: 1 }));
  assert.strictEqual(
    validateGradeContract({ status: "absent", score: null, maxScore: 20, coefficient: 1 }),
    null,
  );
  assert.ok(validateGradeContract({ status: "graded", score: 21, maxScore: 20, coefficient: 1 }));

  const state = baseState();

  // evaluation_id obligatoire
  const missingEval = validateNoteWrite(state, {
    studentId: "STU-1",
    schoolCode: "SCH-001",
    subject: "Maths",
    value: 10,
    gradeStatus: "graded",
  });
  assert.ok(missingEval && missingEval.includes("evaluation_id"));

  // Unicité élève × évaluation
  const duplicate = validateNoteWrite(state, {
    studentId: "MAT-1",
    schoolCode: "SCH-001",
    evaluationId: "EVAL-1",
    subject: "Maths",
    value: 15,
    gradeStatus: "Saisie",
  });
  assert.ok(duplicate && duplicate.includes("existe déjà"));

  // Autre évaluation validée OK
  state.evaluations.push({
    id: "EVAL-2",
    schoolCode: "SCH-001",
    className: "6ème A",
    subject: "Maths",
    scale: 20,
    coefficient: 1,
    status: "Validée",
    active: true,
  });
  const otherEval = validateNoteWrite(state, {
    studentId: "STU-1",
    schoolCode: "SCH-001",
    evaluationId: "EVAL-2",
    subject: "Maths",
    className: "6ème A",
    value: 15,
    gradeStatus: "Saisie",
  });
  assert.strictEqual(otherEval, null);

  // Absent sans score
  const absentOk = validateNoteWrite(state, {
    studentId: "STU-1",
    schoolCode: "SCH-001",
    evaluationId: "EVAL-2",
    subject: "Maths",
    className: "6ème A",
    gradeStatus: "Absente",
    value: null,
  });
  assert.strictEqual(absentOk, null);

  // Évaluation publiée : saisie refusée (sauf bypass options)
  const publishedLocked = validateNoteWrite(state, {
    studentId: "STU-1",
    schoolCode: "SCH-001",
    evaluationId: "EVAL-PUB",
    subject: "Maths",
    className: "6ème A",
    value: 11,
    gradeStatus: "Saisie",
  });
  assert.ok(publishedLocked && publishedLocked.includes("Publiée"));

  state.evaluations.push({
    id: "EVAL-DRAFT",
    schoolCode: "SCH-001",
    className: "6ème A",
    subject: "Maths",
    scale: 20,
    coefficient: 1,
    status: "Brouillon",
    active: true,
  });
  const draftAllowed = validateNoteWrite(state, {
    studentId: "STU-1",
    schoolCode: "SCH-001",
    evaluationId: "EVAL-DRAFT",
    subject: "Maths",
    className: "6ème A",
    value: 14,
    gradeStatus: "Saisie",
  });
  assert.equal(draftAllowed, null, "NOTES-P1 : brouillon saisissable");

  // Calcul pondéré canonique — exclusions
  const { average } = weightedAverage(
    [
      { value: 10, scale: 20, evaluationCoefficient: 1, gradeStatus: "graded" },
      { value: 20, scale: 20, evaluationCoefficient: 1, gradeStatus: "graded" },
      { value: null, scale: 20, evaluationCoefficient: 2, gradeStatus: "absent" },
      { value: null, scale: 20, evaluationCoefficient: 2, gradeStatus: "excused" },
    ],
    { displayScale: 20 },
  );
  assert.strictEqual(average, 15);
  assert.strictEqual(formatAverageForDisplay(15, 2), "15.00");

  const book = new GradeBookService({
    students: [{ id: "STU-1", className: "6ème A" }],
    notes: [
      {
        studentId: "STU-1",
        subject: "Maths",
        value: 10,
        scale: 20,
        evaluationCoefficient: 1,
        gradeStatus: "graded",
        period: "Trimestre 1",
      },
      {
        studentId: "STU-1",
        subject: "Maths",
        value: null,
        scale: 20,
        evaluationCoefficient: 1,
        gradeStatus: "exempt",
        period: "Trimestre 1",
      },
    ],
    courses: [{ name: "Maths", coefficient: 2 }],
  });
  const studentAverage = book.getStudentAverage("STU-1", "Trimestre 1");
  assert.strictEqual(studentAverage.average, 10);

  // Concurrence version
  assert.strictEqual(noteVersion({ version: 3 }), 3);
  const bumped = bumpNoteVersion({ version: 2, updatedBy: "u1" }, { sub: "u2" });
  assert.strictEqual(bumped.version, 3);
  assert.throws(
    () => assertNoteOptimisticLock({ version: 2 }, 1),
    (error) => error?.statusCode === 409 || error?.status === 409,
  );

  // Dédup déterministe
  const canonical = pickCanonicalGradeRow([
    { id: "a", version: 1, updated_at: "2026-07-01T10:00:00Z", created_at: "2026-07-01T09:00:00Z" },
    { id: "b", version: 3, updated_at: "2026-07-01T08:00:00Z", created_at: "2026-07-01T07:00:00Z" },
    { id: "c", version: 3, updated_at: "2026-07-02T08:00:00Z", created_at: "2026-07-01T07:00:00Z" },
  ]);
  assert.strictEqual(canonical.id, "c");

  // Mapping grade status
  assert.strictEqual(toGradeStatus("Justifiée"), "excused");
  assert.strictEqual(toGradeStatus("Non justifiée"), "not_submitted");
  assert.strictEqual(toGradeStatus("Dispensée"), "exempt");

  console.log("noteContract.test.js : OK");
}

run();
