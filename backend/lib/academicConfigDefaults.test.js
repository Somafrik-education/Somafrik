"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LEGACY_DEFAULT_ACADEMIC_PERIODS,
  defaultAcademicPeriods,
  hasLegacyDefaultAcademicPeriodSignature,
} = require("./academicConfigDefaults");

test("defaultAcademicPeriods dérive les trimestres de l'année 2026-2027", () => {
  const periods = defaultAcademicPeriods(
    { start_date: "2026-09-01", end_date: "2027-08-31" },
    "trimestre",
  );

  assert.deepEqual(
    periods.map(({ name, startDate, endDate }) => ({ name, startDate, endDate })),
    [
      { name: "Trimestre 1", startDate: "01-09-2026", endDate: "31-12-2026" },
      { name: "Trimestre 2", startDate: "01-01-2027", endDate: "31-03-2027" },
      { name: "Trimestre 3", startDate: "01-04-2027", endDate: "30-06-2027" },
    ],
  );
});

test("defaultAcademicPeriods respecte le mode semestre de l'établissement", () => {
  const periods = defaultAcademicPeriods(
    { startDate: "2026-09-01", endDate: "2027-08-31" },
    "semestre",
  );

  assert.deepEqual(
    periods.map(({ name, startDate, endDate }) => ({ name, startDate, endDate })),
    [
      { name: "Semestre 1", startDate: "01-09-2026", endDate: "31-01-2027" },
      { name: "Semestre 2", startDate: "01-02-2027", endDate: "30-06-2027" },
    ],
  );
});

test("signature legacy ne reconnaît que les trois defaults historiques exacts", () => {
  assert.equal(hasLegacyDefaultAcademicPeriodSignature(LEGACY_DEFAULT_ACADEMIC_PERIODS), true);
  assert.equal(
    hasLegacyDefaultAcademicPeriodSignature([
      { name: "Trimestre 1", startDate: "01-09-2026", endDate: "31-12-2026" },
      { name: "Trimestre 2", startDate: "01-01-2027", endDate: "31-03-2027" },
      { name: "Trimestre 3", startDate: "01-04-2027", endDate: "30-06-2027" },
    ]),
    false,
  );
  assert.equal(
    hasLegacyDefaultAcademicPeriodSignature([
      { name: "Période personnalisée", startDate: "01-09-2025", endDate: "31-12-2025" },
    ]),
    false,
  );
});
