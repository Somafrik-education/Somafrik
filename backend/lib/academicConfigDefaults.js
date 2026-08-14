"use strict";

const { applySystemActivePeriod } = require("./academicPeriods");

function defaultAcademicPeriods() {
  return [
    {
      id: "trimestre-1",
      name: "Trimestre 1",
      type: "Trimestre",
      order: 1,
      startDate: "01-09-2025",
      endDate: "31-12-2025",
      active: true,
    },
    {
      id: "trimestre-2",
      name: "Trimestre 2",
      type: "Trimestre",
      order: 2,
      startDate: "01-01-2026",
      endDate: "31-03-2026",
      active: false,
    },
    {
      id: "trimestre-3",
      name: "Trimestre 3",
      type: "Trimestre",
      order: 3,
      startDate: "01-04-2026",
      endDate: "30-06-2026",
      active: false,
    },
  ];
}

function inferPeriodMode(periods) {
  const names = periods.map((period) => String(period.name ?? "").toLowerCase());
  if (names.some((name) => name.includes("semestre"))) return "semestre";
  if (names.some((name) => name.includes("trimestre"))) return "trimestre";
  return "periode";
}

function withSystemActivePeriods(config) {
  if (!config || !Array.isArray(config.periods)) return config;
  return {
    ...config,
    periods: applySystemActivePeriod(config.periods),
  };
}

module.exports = {
  defaultAcademicPeriods,
  inferPeriodMode,
  withSystemActivePeriods,
};
