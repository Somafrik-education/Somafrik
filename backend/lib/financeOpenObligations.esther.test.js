"use strict";

/**
 * P1 — Esther OKITO : roster #745 (UUID) → obligations ouvertes réelles.
 * RED avant alignement du contrat F5 (studentId public vs studentDbId UUID).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  collectOpenObligationsFromProjection,
  isOpenObligationFromProjection,
} = require("./financeWebMobileWriteContract");

const ESTHER_UUID = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const ESTHER_CODE = "CG-ITC-OE-26-00001";
const ESTHER_IDENTITY = {
  id: ESTHER_UUID,
  studentId: ESTHER_UUID,
  studentDbId: ESTHER_UUID,
  studentCode: ESTHER_CODE,
  matricule: ESTHER_CODE,
  publicId: ESTHER_CODE,
};

function fee(overrides = {}) {
  return {
    id: "obl-esther-sco",
    obligationId: "obl-esther-sco",
    studentId: ESTHER_CODE,
    studentDbId: ESTHER_UUID,
    label: "Scolarité T1",
    feeType: "Scolarité",
    status: "À payer",
    balance: 140_000,
    amountDue: 140_000,
    amountPaid: 0,
    currency: "CDF",
    periodLabel: "T1",
    className: "1ère Primaire A",
    ...overrides,
  };
}

describe("P1 Esther — obligations ouvertes après #745", () => {
  it("Esther sélectionnée (UUID roster) ⇒ obligation ouverte réelle", () => {
    const open = collectOpenObligationsFromProjection(ESTHER_IDENTITY, [fee()]);
    assert.equal(open.length, 1);
    assert.equal(open[0].obligationId, "obl-esther-sco");
    assert.equal(open[0].balance, 140_000);
    assert.equal(isOpenObligationFromProjection(fee()), true);
  });

  it("même vérité si le client ne passe que l'UUID roster", () => {
    const open = collectOpenObligationsFromProjection(ESTHER_UUID, [fee()]);
    assert.equal(open.length, 1);
    assert.equal(open[0].obligationId, "obl-esther-sco");
  });

  it("élève sans obligation ⇒ aucune dette ouverte (Non imputé légitime)", () => {
    assert.deepEqual(collectOpenObligationsFromProjection(ESTHER_IDENTITY, []), []);
    assert.deepEqual(
      collectOpenObligationsFromProjection(ESTHER_IDENTITY, [
        fee({ id: "obl-other", studentId: "CD-IN-XX-26-00099", studentDbId: "ffffffff-0000-4000-8000-ffffffffffff" }),
      ]),
      [],
    );
  });

  it("paiement partiel ⇒ reste dû exact", () => {
    const open = collectOpenObligationsFromProjection(ESTHER_IDENTITY, [
      fee({
        status: "Partiellement payé",
        amountPaid: 50_000,
        balance: 90_000,
      }),
    ]);
    assert.equal(open.length, 1);
    assert.equal(open[0].balance, 90_000);
    assert.equal(open[0].amountPaid, 50_000);
  });

  it("obligation soldée ⇒ absente des dettes ouvertes", () => {
    const settled = fee({
      status: "Payé",
      amountPaid: 140_000,
      balance: 0,
    });
    assert.equal(isOpenObligationFromProjection(settled), false);
    assert.equal(collectOpenObligationsFromProjection(ESTHER_IDENTITY, [settled]).length, 0);
  });

  it("isolation tenant : obligation d'un autre établissement ignorée", () => {
    const open = collectOpenObligationsFromProjection(ESTHER_IDENTITY, [
      fee(),
      fee({
        id: "obl-foreign",
        studentId: "CD-XX-OTH-26-99999",
        studentDbId: "cccccccc-3333-4333-8333-cccccccccccc",
        label: "Scolarité tenant B",
        balance: 99_000,
      }),
    ]);
    assert.deepEqual(open.map((row) => row.obligationId), ["obl-esther-sco"]);
  });
});
