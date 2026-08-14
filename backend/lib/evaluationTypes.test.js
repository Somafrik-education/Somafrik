"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  EVALUATION_TYPES_ERROR,
  DEFAULT_EVALUATION_TYPES,
  assertNoLegacyEvaluationTypesWrite,
  stripLegacyEvaluationTypes,
  isLegacyEvaluationTypesAmbiguous,
  normalizeCode,
} = require("./evaluationTypesManagement");

test("assertNoLegacyEvaluationTypesWrite rejette evaluationTypes y compris null/[]", () => {
  for (const payload of [{ evaluationTypes: ["Devoir"] }, { evaluationTypes: [] }, { evaluationTypes: null }]) {
    assert.throws(() => assertNoLegacyEvaluationTypesWrite(payload), (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, EVALUATION_TYPES_ERROR.LEGACY_EVALUATION_TYPES_WRITE_FORBIDDEN);
      return true;
    });
  }
  assert.doesNotThrow(() => assertNoLegacyEvaluationTypesWrite({ periods: [] }));
});

test("stripLegacyEvaluationTypes retire la clé interdite", () => {
  const next = stripLegacyEvaluationTypes({ evaluationTypes: ["x"], periods: [] });
  assert.equal("evaluationTypes" in next, false);
  assert.ok(Array.isArray(next.periods));
});

test("normalizeCode produit un code stable", () => {
  assert.equal(normalizeCode("Travail pratique"), "travail_pratique");
  assert.equal(normalizeCode("Contrôle continu"), "controle_continu");
});

test("inventaire : vide/null autorisés ; sous-ensemble, sur-ensemble et custom sont ambigus ; catalogue exact OK", () => {
  const exactNames = DEFAULT_EVALUATION_TYPES.map((row) => row.name);
  const exactCodes = DEFAULT_EVALUATION_TYPES.map((row) => row.code);
  assert.equal(isLegacyEvaluationTypesAmbiguous({}), false);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ periods: [] }), false);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: [] }), false);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: null }), false);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: ["Devoir"] }), true);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: ["Devoir", "Interrogation", "Examen"] }), true);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: ["Composition", "Rattrapage"] }), true);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: exactNames }), false);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: exactCodes }), false);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: [...exactNames].reverse() }), false);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: [...exactNames, "Quiz"] }), true);
  assert.equal(isLegacyEvaluationTypesAmbiguous({ evaluationTypes: ["Devoir", "Quiz surprise"] }), true);
});
