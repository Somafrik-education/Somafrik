"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { obligationMatchesPaymentFeeType } = require("./financeFeeTypeMatch");

describe("obligationMatchesPaymentFeeType", () => {
  it("maps Mobile Scolarité onto canonical Mensualité", () => {
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Mensualité", label: "Mensualité — Janvier" }, "Scolarité"),
      true,
    );
  });

  it("maps Web Minerval / scolarité onto Mensualité", () => {
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Mensualité", label: "Minerval" }, "Minerval / scolarité"),
      true,
    );
  });

  it("keeps Inscription exact", () => {
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Inscription", label: "Inscription" }, "Inscription"),
      true,
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Mensualité", label: "Mensualité" }, "Inscription"),
      false,
    );
  });

  it("maps Cantine onto Annexe labeled cantine, not transport", () => {
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Cantine" }, "Cantine"),
      true,
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Transport" }, "Cantine"),
      false,
    );
  });
});
