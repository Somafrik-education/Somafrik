"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isClassNameUniquenessViolation,
  isClassCodeUniquenessViolation,
  formatClassesNameDuplicateDiagnostic,
  CLASSES_NAME_UNIQUE_INDEX,
} = require("./classesUniqueness");

describe("classesUniqueness 23505 mapping", () => {
  it("maps name index violation to name collision only", () => {
    const error = {
      code: "23505",
      constraint: "uq_classes_school_year_normalized_name",
      detail: "Key (school_id, academic_year_id, lower(btrim(name)))=(...) already exists.",
    };
    assert.equal(isClassNameUniquenessViolation(error), true);
    assert.equal(isClassCodeUniquenessViolation(error), false);
  });

  it("maps class_code violation to classCode collision only", () => {
    const error = {
      code: "23505",
      constraint: "classes_class_code_key",
      detail: "Key (class_code)=(CLS-1) already exists.",
    };
    assert.equal(isClassNameUniquenessViolation(error), false);
    assert.equal(isClassCodeUniquenessViolation(error), true);
  });

  it("ignores unrelated errors", () => {
    assert.equal(isClassNameUniquenessViolation({ code: "23503" }), false);
    assert.equal(isClassCodeUniquenessViolation(null), false);
  });
});

describe("classesUniqueness fail-safe diagnostic", () => {
  it("formats an explicit resolution message without implying deletion", () => {
    const message = formatClassesNameDuplicateDiagnostic(
      [
        {
          school_code: "SCH-A",
          academic_year_name: "2025-2026",
          normalized_name: "6ème a",
          duplicate_count: 2,
          class_codes: ["CLS-1", "CLS-2"],
        },
      ],
      1,
    );
    assert.match(message, /Résolution explicite requise/);
    assert.match(message, /Aucune suppression automatique/);
    assert.match(message, new RegExp(CLASSES_NAME_UNIQUE_INDEX));
    assert.match(message, /SCH-A\/2025-2026\/6ème a×2\[CLS-1,CLS-2\]/);
    assert.doesNotMatch(message, /DELETE|supprim/i);
  });
});
