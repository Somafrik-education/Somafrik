"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  EDUCATION_REFERENCE_ERROR,
  assertNoLegacyAcademicLevelsTracksWrite,
  stripLegacyAcademicLevelsTracks,
  normalizeCode,
} = require("./educationReferenceManagement");

test("assertNoLegacyAcademicLevelsTracksWrite rejette levels y compris null/[]", () => {
  for (const payload of [{ levels: ["1ère"] }, { levels: [] }, { levels: null }, { tracks: ["Générale"] }, { tracks: {} }]) {
    assert.throws(() => assertNoLegacyAcademicLevelsTracksWrite(payload), (error) => {
      assert.ok(error.statusCode === 400);
      assert.ok(
        error.code === EDUCATION_REFERENCE_ERROR.LEGACY_ACADEMIC_LEVELS_WRITE_FORBIDDEN ||
          error.code === EDUCATION_REFERENCE_ERROR.LEGACY_ACADEMIC_STREAMS_WRITE_FORBIDDEN,
      );
      return true;
    });
  }
});

test("stripLegacyAcademicLevelsTracks retire les clés interdites", () => {
  const next = stripLegacyAcademicLevelsTracks({ levels: ["x"], tracks: ["y"], periods: [] });
  assert.deepEqual(next, { periods: [] });
});

test("normalizeCode produit un code stable", () => {
  assert.equal(normalizeCode("1ère Année"), "1ere_annee");
});
