"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { PEDAGOGY_ERROR } = require("./pedagogyManagement");
const { PERMISSION_DENIED } = require("../services/rbacService");
const { isValidatedEvaluationStatus, toEvaluationStatus } = require("./gradesCanonical");
const {
  assertEvaluationAllowsGradeEntry,
  assertStudentEnrolledInEvaluationClass,
  assertTeacherCannotValidateEvaluation,
  assertTeacherGradeMutationPermission,
  isTeacherPrincipal,
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

test("brouillon / ouverte / validée autorisent la saisie ; publiée / annulée refusent", () => {
  for (const status of ["draft", "Brouillon", "open", "Ouverte", "locked", "Validée"]) {
    assert.doesNotThrow(() => assertEvaluationAllowsGradeEntry({ id: "e1", status, active: true }));
  }
  for (const status of ["published", "Publiée", "archived", "Annulée"]) {
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
  assert.throws(
    () => assertTeacherCannotValidateEvaluation({ role: "teacher" }, "Validée"),
    (error) => error.statusCode === 403,
  );
  assert.doesNotThrow(() => assertTeacherCannotValidateEvaluation({ role: "Enseignant" }, "Brouillon"));
  assert.doesNotThrow(() => assertTeacherCannotValidateEvaluation({ role: "Préfet des études" }, "Validée"));
  assert.doesNotThrow(() => assertTeacherCannotValidateEvaluation({ role: "Admin School" }, "Validée"));
});

test("isTeacherPrincipal reconnaît Enseignant, teacher et TEACHER", () => {
  assert.equal(isTeacherPrincipal({ role: "Enseignant" }), true);
  assert.equal(isTeacherPrincipal({ role: "teacher" }), true);
  assert.equal(isTeacherPrincipal({ role: "TEACHER" }), true);
  assert.equal(isTeacherPrincipal({ role: "Préfet des études" }), false);
});

test("CREATE saisit une nouvelle note ; UPDATE modifie ; READ refuse", () => {
  const createOnly = { role: "Enseignant", permissions: ["Notes:READ", "Notes:CREATE"] };
  const updateOnly = { role: "Enseignant", permissions: ["Notes:READ", "Notes:UPDATE"] };
  const readOnly = { role: "Enseignant", permissions: ["Notes:READ"] };
  assert.doesNotThrow(() => assertTeacherGradeMutationPermission(createOnly, null));
  assert.throws(
    () => assertTeacherGradeMutationPermission(createOnly, { id: "g1" }),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
  assert.doesNotThrow(() => assertTeacherGradeMutationPermission(updateOnly, { id: "g1" }));
  assert.throws(
    () => assertTeacherGradeMutationPermission(updateOnly, null),
    (error) => error.statusCode === 403 && error.code === PERMISSION_DENIED,
  );
  assert.throws(
    () => assertTeacherGradeMutationPermission(readOnly, null),
    (error) => error.statusCode === 403,
  );
  assert.doesNotThrow(() =>
    assertTeacherGradeMutationPermission({ role: "Préfet des études", permissions: ["Notes:READ"] }, null),
  );
});
