"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ONCE_PERIOD_KEY,
  academicYearStartYear,
  periodKeyForMonth,
  expandFeeItemPeriods,
  isPeriodAfterEffectiveMonth,
} = require("./financeObligationPeriod");

describe("periodKeyForMonth", () => {
  it("place SEP–DEC sur l'année de début et JAN–JUIN sur l'année suivante", () => {
    assert.equal(academicYearStartYear("2026-2027"), 2026);
    assert.equal(periodKeyForMonth("2026-2027", "Septembre"), "2026-09");
    assert.equal(periodKeyForMonth("2026-2027", "Décembre"), "2026-12");
    assert.equal(periodKeyForMonth("2026-2027", "Janvier"), "2027-01");
    assert.equal(periodKeyForMonth("2026-2027", "Juin"), "2027-06");
  });
});

describe("expandFeeItemPeriods", () => {
  it("crée une clé par mois, pas une obligation Mensualité", () => {
    const periods = expandFeeItemPeriods(
      { monthlyMonths: ["Septembre", "Octobre", "Novembre"], feeType: "Scolarité" },
      "2026-2027",
    );
    assert.deepEqual(
      periods.map((row) => row.periodKey),
      ["2026-09", "2026-10", "2026-11"],
    );
  });

  it("frais unique → ONCE stable", () => {
    const periods = expandFeeItemPeriods({ feeType: "Inscription", label: "Inscription" }, "2026-2027");
    assert.equal(periods.length, 1);
    assert.equal(periods[0].periodKey, ONCE_PERIOD_KEY);
  });
});

describe("isPeriodAfterEffectiveMonth", () => {
  it("traite le mois courant comme déjà commencé (pas de prorata)", () => {
    assert.equal(isPeriodAfterEffectiveMonth("2027-02", "2027-01-15"), true);
    assert.equal(isPeriodAfterEffectiveMonth("2027-01", "2027-01-15"), false);
    assert.equal(isPeriodAfterEffectiveMonth("2026-12", "2027-01-15"), false);
  });
});
