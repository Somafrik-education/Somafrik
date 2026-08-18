"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");
const { isValidatedEvaluationStatus, toEvaluationStatus } = require("./gradesCanonical");
const {
  assertEvaluationAllowsGradeEntry,
  assertStudentEnrolledInEvaluationClass,
  assertTeacherCannotValidateEvaluation,
} = require("./evaluationGradeEntry");

test("Validée UI = locked PG, pas une comparaison brute", () => {
  assert.equal(toEvaluationStatus("Validée"), "locked");
  assert.equal(isValidatedEvaluationStatus("Validée"), true);
  assert.equal(isValidatedEvaluationStatus("locked"), true);
  assert.equal(isValidatedEvaluationStatus("Brouillon"), false);
  assert.equal(isValidatedEvaluationStatus("draft"), false);
  assert.equal(isValidatedEvaluationStatus("published"), false);
  assert.equal(isValidatedEvaluationStatus("Publiée"), false);
});

test("brouillon / ouverte / publiée / annulée refusent la saisie 409 EVALUATION_NOT_VALIDATED", () => {
  for (const status of ["draft", "Brouillon", "open", "Ouverte", "published", "Publiée", "archived", "Annulée"]) {
    assert.throws(
      () => assertEvaluationAllowsGradeEntry({ id: "e1", status, active: true }),
      (error) => error.statusCode === 409 && error.code === PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED,
    );
  }
  assert.throws(
    () => assertEvaluationAllowsGradeEntry({ id: "e1", status: "locked", active: false }),
    (error) => error.code === PEDAGOGY_ERROR.EVALUATION_NOT_VALIDATED,
  );
});

test("Validée / locked autorise la saisie", () => {
  assert.doesNotThrow(() => assertEvaluationAllowsGradeEntry({ id: "e1", status: "Validée", active: true }));
  assert.doesNotThrow(() => assertEvaluationAllowsGradeEntry({ id: "e1", status: "locked", active: true }));
});

test("élève hors classe d'évaluation refusé", () => {
  assert.throws(
    () =>
      assertStudentEnrolledInEvaluationClass(
        { id: "s1", class_id: "class-b" },
        { id: "e1", class_id: "class-a" },
      ),
    (error) => error.statusCode === 409 && error.code === PEDAGOGY_ERROR.STUDENT_NOT_ENROLLED,
  );
  assert.doesNotThrow(() =>
    assertStudentEnrolledInEvaluationClass({ id: "s1", class_id: "class-a" }, { id: "e1", class_id: "class-a" }),
  );
});

test("enseignant ne peut pas valider / publier une évaluation", () => {
  assert.throws(
    () => assertTeacherCannotValidateEvaluation({ role: "Enseignant" }, "Validée"),
    (error) => error.statusCode === 403 && error.code === PEDAGOGY_ERROR.EVALUATION_VALIDATION_FORBIDDEN,
  );
  assert.throws(
    () => assertTeacherCannotValidateEvaluation({ role: "Enseignant" }, "locked"),
    (error) => error.statusCode === 403,
  );
  assert.doesNotThrow(() => assertTeacherCannotValidateEvaluation({ role: "Enseignant" }, "Brouillon"));
  assert.doesNotThrow(() => assertTeacherCannotValidateEvaluation({ role: "Préfet des études" }, "Validée"));
  assert.doesNotThrow(() => assertTeacherCannotValidateEvaluation({ role: "Admin School" }, "Validée"));
});
