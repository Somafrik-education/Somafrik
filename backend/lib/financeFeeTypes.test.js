"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  CANONICAL_FEE_TYPE_CATALOG,
  FEE_TYPE_ERROR,
  persistableFeeType,
  resolveFeeType,
  isTuitionFeeType,
  isUnallocatedFeeTypeInput,
  activeFeeTypeCatalog,
  canonicalFeeTypeCatalog,
} = require("./financeFeeTypes");
const { INVARIANT_ERROR: DOMAIN_ERROR } = require("./financeDomainInvariants");

describe("catalogue canonique", () => {
  it("expose 8 types V1 avec code stable, sans Acompte ni Mensualité ni Annexe", () => {
    const codes = CANONICAL_FEE_TYPE_CATALOG.map((row) => row.code);
    assert.deepEqual(codes, [
      "ENROLLMENT",
      "REENROLLMENT",
      "TUITION",
      "EXAM",
      "UNIFORM",
      "TRANSPORT",
      "CANTEEN",
      "OTHER",
    ]);
    const labels = CANONICAL_FEE_TYPE_CATALOG.map((row) => row.label);
    assert.equal(labels.includes("Acompte"), false);
    assert.equal(labels.includes("Mensualité"), false);
    assert.equal(labels.includes("Annexe"), false);
    assert.equal(labels.includes("Minerval / scolarité"), false);
    assert.equal(activeFeeTypeCatalog().every((row) => row.code && row.feeType && row.active), true);
    assert.equal(canonicalFeeTypeCatalog().length, 8);
  });
});

describe("mapping legacy", () => {
  it("Mensualité et Minerval sont des alias de Scolarité, pas des types", () => {
    assert.equal(resolveFeeType("Mensualité").code, "TUITION");
    assert.equal(resolveFeeType("Minerval / scolarité").code, "TUITION");
    assert.equal(resolveFeeType("Scolarité").code, "TUITION");
    assert.equal(persistableFeeType("Mensualité"), "Scolarité");
    assert.equal(persistableFeeType("minerval"), "Scolarité");
    assert.equal(isTuitionFeeType("Mensualité"), true);
    assert.equal(isTuitionFeeType("Inscription"), false);
  });

  it("codes stables TUITION / ENROLLMENT sont acceptés à l'écriture", () => {
    assert.equal(persistableFeeType("TUITION"), "Scolarité");
    assert.equal(persistableFeeType("ENROLLMENT"), "Inscription");
  });
});

describe("Acompte interdit", () => {
  it("refuse Acompte comme type canonique", () => {
    assert.throws(() => persistableFeeType("Acompte"), (error) => error.code === DOMAIN_ERROR.FORBIDDEN_FEE_TYPE);
    assert.equal(resolveFeeType("Acompte"), null);
    assert.equal(isUnallocatedFeeTypeInput("Acompte"), true);
    assert.equal(isUnallocatedFeeTypeInput(""), true);
  });
});

describe("ambiguïté fail closed", () => {
  it("refuse Annexe et Bulletin à l'écriture, sans mapping silencieux", () => {
    assert.throws(() => persistableFeeType("Annexe"), (error) => error.code === FEE_TYPE_ERROR.AMBIGUOUS);
    assert.throws(() => persistableFeeType("Frais de bulletin"), (error) => error.code === FEE_TYPE_ERROR.AMBIGUOUS);
    assert.equal(resolveFeeType("Annexe"), null);
    assert.throws(() => persistableFeeType("Frais mystère"), (error) => error.code === FEE_TYPE_ERROR.UNKNOWN);
  });
});

describe("type inactif", () => {
  it("tous les types V1 sont actifs — un type inactif serait refusé à l'écriture", () => {
    assert.equal(CANONICAL_FEE_TYPE_CATALOG.every((row) => row.active === true), true);
    assert.equal(resolveFeeType("Uniforme").active, true);
  });
});
