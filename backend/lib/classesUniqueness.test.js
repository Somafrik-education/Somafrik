"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isClassNameUniquenessViolation,
  isClassCodeUniquenessViolation,
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
