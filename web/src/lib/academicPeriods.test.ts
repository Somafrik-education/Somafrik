import { describe, expect, it } from "vitest";
import { defaultPeriodsForMode, normalizeStoredPeriods } from "./academicPeriods";

describe("academicPeriods — defaults année scolaire", () => {
  it("en septembre 2026 génère les trimestres 2026-2027", () => {
    const periods = defaultPeriodsForMode("trimestre", new Date(2026, 8, 2));
    expect(periods.map(({ name, startDate, endDate }) => ({ name, startDate, endDate }))).toEqual([
      { name: "Trimestre 1", startDate: "01-09-2026", endDate: "31-12-2026" },
      { name: "Trimestre 2", startDate: "01-01-2027", endDate: "31-03-2027" },
      { name: "Trimestre 3", startDate: "01-04-2027", endDate: "30-06-2027" },
    ]);
  });

  it("en janvier 2027 reste sur l'année scolaire 2026-2027", () => {
    const periods = normalizeStoredPeriods([], "trimestre", new Date(2027, 0, 15));
    expect(periods[0]?.startDate).toBe("01-09-2026");
    expect(periods[2]?.endDate).toBe("30-06-2027");
  });

  it("ne modifie pas les périodes déjà stockées", () => {
    const stored = [
      {
        name: "Trimestre personnalisé",
        startDate: "10-09-2026",
        endDate: "20-12-2026",
        order: 1,
      },
    ];
    const periods = normalizeStoredPeriods(stored, "trimestre", new Date(2026, 8, 2));
    expect(periods[0]?.startDate).toBe("10-09-2026");
    expect(periods[0]?.endDate).toBe("20-12-2026");
  });
});
