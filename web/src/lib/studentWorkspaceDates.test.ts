import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeAgeFromCivilDate,
  formatAgeLabel,
  formatCivilDateLabel,
  parseCivilDate,
  parseCivilDateParts,
  toCanonicalCivilDate,
} from "./studentWorkspaceDates";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "studentWorkspaceDates.ts"),
  "utf8",
);

describe("FICHE-FIX-02 — dates civiles élève", () => {
  it("DATE-01 : lecture DD-MM-YYYY", () => {
    expect(parseCivilDateParts("12-04-2012")).toEqual({
      year: 2012,
      month: 4,
      day: 12,
    });
    expect(toCanonicalCivilDate("12-04-2012")).toBe("2012-04-12");
    expect(formatCivilDateLabel("12-04-2012")).toBe("12 avril 2012");
  });

  it("DATE-02 : lecture YYYY-MM-DD", () => {
    expect(parseCivilDateParts("2012-04-12")).toEqual({
      year: 2012,
      month: 4,
      day: 12,
    });
    expect(toCanonicalCivilDate("2012-04-12")).toBe("2012-04-12");
    expect(formatCivilDateLabel("2012-04-12")).toBe("12 avril 2012");
  });

  it("DATE-03 : distinction jour/mois ambigu", () => {
    expect(formatCivilDateLabel("12-04-2012")).toBe("12 avril 2012");
    expect(formatCivilDateLabel("04-12-2012")).toBe("04 décembre 2012");
    expect(toCanonicalCivilDate("12-04-2012")).toBe("2012-04-12");
    expect(toCanonicalCivilDate("04-12-2012")).toBe("2012-12-04");
    expect(toCanonicalCivilDate("12-04-2012")).not.toBe(
      toCanonicalCivilDate("04-12-2012"),
    );
  });

  it("DATE-04 : jour supérieur à 12", () => {
    expect(parseCivilDateParts("15-03-2015")).toEqual({
      year: 2015,
      month: 3,
      day: 15,
    });
    expect(formatCivilDateLabel("15-03-2015")).toBe("15 mars 2015");
    expect(toCanonicalCivilDate("15-03-2015")).toBe("2015-03-15");
  });

  it("DATE-05 : année bissextile valide", () => {
    expect(parseCivilDateParts("29-02-2024")).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(toCanonicalCivilDate("29-02-2024")).toBe("2024-02-29");
    expect(formatCivilDateLabel("29-02-2024")).toBe("29 février 2024");
    expect(parseCivilDateParts("2024-02-29")).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it("DATE-06 : année non bissextile invalide", () => {
    expect(parseCivilDateParts("29-02-2023")).toBeNull();
    expect(parseCivilDate("29-02-2023")).toBeNull();
    expect(toCanonicalCivilDate("29-02-2023")).toBeNull();
    expect(formatCivilDateLabel("29-02-2023")).toBe("29-02-2023");
    expect(formatCivilDateLabel("29-02-2023")).not.toMatch(/mars|1 mars|01 mars/i);
  });

  it("DATE-07 : jour inexistant", () => {
    expect(parseCivilDateParts("31-04-2012")).toBeNull();
    expect(parseCivilDate("31-04-2012")).toBeNull();
    expect(toCanonicalCivilDate("31-04-2012")).toBeNull();
    expect(formatCivilDateLabel("31-04-2012")).toBe("31-04-2012");
    expect(formatCivilDateLabel("31-04-2012")).not.toMatch(/mai|1 mai|01 mai/i);
  });

  it("DATE-08 : chaîne vide / null", () => {
    expect(parseCivilDateParts("")).toBeNull();
    expect(parseCivilDateParts("   ")).toBeNull();
    expect(parseCivilDateParts(null)).toBeNull();
    expect(parseCivilDateParts(undefined)).toBeNull();
    expect(toCanonicalCivilDate("")).toBeNull();
    expect(toCanonicalCivilDate(null)).toBeNull();
    expect(parseCivilDate("")).toBeNull();
    expect(formatCivilDateLabel(null)).toBe("Non renseigné");
    expect(formatCivilDateLabel("")).toBe("Non renseigné");
    expect(formatCivilDateLabel("   ")).toBe("Non renseigné");
    expect(formatAgeLabel(null)).toBe("Non renseigné");
    expect(computeAgeFromCivilDate("")).toBeNull();
  });

  it("DATE-09 : stabilité UTC et fuseaux — pas de new Date(texte_non_ISO)", () => {
    expect(src).not.toMatch(/new Date\(\s*(normalized|value|raw|text)\s*\)/);
    expect(src).toMatch(/timeZone:\s*"UTC"/);

    const isoMidnight = "2012-04-12T00:00:00.000Z";
    expect(formatCivilDateLabel("12-04-2012")).toBe("12 avril 2012");
    expect(formatCivilDateLabel("2012-04-12")).toBe("12 avril 2012");
    expect(formatCivilDateLabel(isoMidnight)).toBe("12 avril 2012");
    expect(toCanonicalCivilDate(isoMidnight)).toBe("2012-04-12");

    const parsed = parseCivilDate("2012-04-12");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2012);
    expect(parsed?.getMonth()).toBe(3);
    expect(parsed?.getDate()).toBe(12);

    const ambiguous = parseCivilDate("12-04-2012");
    expect(ambiguous?.getFullYear()).toBe(2012);
    expect(ambiguous?.getMonth()).toBe(3);
    expect(ambiguous?.getDate()).toBe(12);
  });

  it("rejette les formats incomplets sans les réécrire", () => {
    expect(parseCivilDateParts("12-04")).toBeNull();
    expect(parseCivilDateParts("2012-04")).toBeNull();
    expect(parseCivilDateParts("12/04/2012")).toBeNull();
    expect(formatCivilDateLabel("12/04/2012")).toBe("12/04/2012");
    expect(formatCivilDateLabel("not-a-date")).toBe("not-a-date");
  });

  it("calcule l'âge depuis les parties civiles, pas depuis un timestamp UTC", () => {
    const reference = new Date(2026, 3, 11);
    expect(computeAgeFromCivilDate("12-04-2012", reference)).toBe(13);
    expect(computeAgeFromCivilDate("2012-04-12", reference)).toBe(13);
    expect(computeAgeFromCivilDate("12-04-2012", new Date(2026, 3, 12))).toBe(14);
    expect(formatAgeLabel("12-04-2012", "Non renseigné", new Date(2026, 6, 20))).toBe(
      "14 ans",
    );
  });
});
