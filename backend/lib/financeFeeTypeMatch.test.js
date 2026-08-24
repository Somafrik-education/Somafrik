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

  it("rejects implicit aliases outside the validated contract", () => {
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Cantine" }, "Autre frais"),
      false,
      "Autre frais ≠ Cantine",
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Transport" }, "Autre frais"),
      false,
      "Autre frais ≠ Transport",
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Transport" }, "Cantine"),
      false,
      "Cantine ≠ Transport",
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Inscription", label: "Inscription" }, "Réinscription"),
      false,
      "Réinscription ≠ Inscription",
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Aide scolarité" }, "Scolarité"),
      false,
      "Scolarité ≠ Annexe dont le label contient accidentellement scolarité",
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Examen" }, "Examen"),
      false,
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Bulletin" }, "Bulletin"),
      false,
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Transport" }, "Transport"),
      false,
    );
    assert.equal(
      obligationMatchesPaymentFeeType({ feeType: "Annexe", label: "Cantine" }, "Annexe"),
      true,
      "type Annexe canonique reste allouable",
    );
  });
});
