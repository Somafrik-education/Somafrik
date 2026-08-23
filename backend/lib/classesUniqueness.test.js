"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  isClassNameUniquenessViolation,
  isClassCodeUniquenessViolation,
  isClassStructuralUniquenessViolation,
  formatClassesNameDuplicateDiagnostic,
  CLASSES_NAME_UNIQUE_INDEX,
  CLASSES_STRUCTURAL_UNIQUE_INDEX,
  COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL,
  CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL,
  CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL,
  COUNT_CLASSES_STRUCTURAL_DUPLICATE_GROUPS_SQL,
  formatClassesStructuralDuplicateDiagnostic,
} = require("./classesUniqueness");

describe("classesUniqueness 23505 mapping", () => {
  it("reconnaît encore l'ancien index de nom pendant la migration", () => {
    const error = {
      code: "23505",
      constraint: CLASSES_NAME_UNIQUE_INDEX,
      detail: "Key (school_id, academic_year_id, lower(btrim(name)))=(...) already exists.",
    };
    assert.equal(isClassNameUniquenessViolation(error), true);
    assert.equal(isClassCodeUniquenessViolation(error), false);
  });

  it("mappe l'unicité structurelle canonique", () => {
    const error = {
      code: "23505",
      constraint: CLASSES_STRUCTURAL_UNIQUE_INDEX,
      detail: `duplicate ${CLASSES_STRUCTURAL_UNIQUE_INDEX}`,
    };
    assert.equal(isClassStructuralUniquenessViolation(error), true);
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

describe("classesUniqueness V2 structural policy", () => {
  it("ne bloque plus le boot sur des noms identiques", () => {
    assert.match(COUNT_CLASSES_NAME_DUPLICATE_GROUPS_SQL, /SELECT 0::int AS duplicate_groups/);
    assert.match(CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL, new RegExp(`DROP INDEX IF EXISTS ${CLASSES_NAME_UNIQUE_INDEX}`));
    assert.doesNotMatch(CREATE_CLASSES_NAME_UNIQUE_INDEX_SQL, /CREATE UNIQUE INDEX/i);
  });

  it("conserve l'index d'unicité structurelle NULL-safe", () => {
    assert.match(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL, new RegExp(CLASSES_STRUCTURAL_UNIQUE_INDEX));
    assert.match(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL, /NULLS NOT DISTINCT/);
    assert.match(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL, /level_id/);
    assert.match(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL, /stream_id/);
    assert.match(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL, /group_id/);
    assert.doesNotMatch(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL, /group_id IS NOT NULL/);
    assert.doesNotMatch(CREATE_CLASSES_STRUCTURAL_UNIQUE_INDEX_SQL, /COALESCE\(stream_id/);
    assert.match(COUNT_CLASSES_STRUCTURAL_DUPLICATE_GROUPS_SQL, /HAVING COUNT\(\*\) > 1/);
  });

  it("documente que le nom est une projection et non une clé", () => {
    const message = formatClassesNameDuplicateDiagnostic(
      [{
        school_code: "SCH-A",
        academic_year_name: "2025-2026",
        normalized_name: "6ème",
        duplicate_count: 2,
        class_codes: ["CLS-1", "CLS-2"],
      }],
      1,
    );
    assert.match(message, /nom d'affichage/i);
    assert.match(message, /structurelle/i);
    assert.doesNotMatch(message, /suppression automatique/i);
  });

  it("la migration PR-1A est fail-closed et sans mutation de données", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, "../db/migrations/20260901_classes_structural_offering_nulls_not_distinct.sql"),
      "utf8",
    );
    assert.match(sql, /NULLS NOT DISTINCT/);
    assert.match(sql, /CLASSES_STRUCTURAL_NULL_DUPLICATES/);
    assert.match(sql, /Aucune correction automatique/);
    const withoutComments = sql.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(withoutComments, /\bUPDATE\b/i);
    assert.doesNotMatch(withoutComments, /\bDELETE\b/i);
  });

  it("le diagnostic de doublons structurels interdit l'auto-fix", () => {
    const message = formatClassesStructuralDuplicateDiagnostic(
      [{
        level_id: "lvl-1",
        stream_id: null,
        group_id: null,
        duplicate_count: 2,
        class_codes: ["CLS-1", "CLS-2"],
      }],
      1,
    );
    assert.match(message, /Aucune correction automatique/);
    assert.match(message, /STOP/);
    assert.match(message, /CLS-1/);
  });
});
