import { describe, expect, it } from "vitest";
import {
  DISPLAY_DATE_HINT,
  formatDateForDisplay,
  formatDateTimeForDisplay,
  isValidDisplayDate,
  parseDisplayDate,
  toApiDate,
} from "./dates";

describe("contrat date Somafrik JJ-MM-AAAA", () => {
  it("formate les dates ISO sans décalage de jour", () => {
    expect(formatDateForDisplay("2026-09-17")).toBe("17-09-2026");
    expect(formatDateForDisplay("2026-01-05")).toBe("05-01-2026");
    expect(formatDateForDisplay("2026-09-17T00:00:00.000Z")).toBe("17-09-2026");
  });

  it("valide strictement le calendrier civil", () => {
    expect(DISPLAY_DATE_HINT).toBe("JJ-MM-AAAA");
    expect(isValidDisplayDate("29-02-2028")).toBe(true);
    expect(isValidDisplayDate("29-02-2027")).toBe(false);
    expect(isValidDisplayDate("31-02-2026")).toBe(false);
    expect(isValidDisplayDate("32-13-2026")).toBe(false);
  });

  it("convertit affichage et API sans Date UTC implicite", () => {
    expect(parseDisplayDate("17-09-2026")).toBe("2026-09-17");
    expect(toApiDate("17-09-2026")).toBe("2026-09-17");
    expect(toApiDate("2026-09-17")).toBe("2026-09-17");
    expect(parseDisplayDate("29-02-2027")).toBe("");
  });

  it("gère les valeurs absentes ou invalides", () => {
    expect(formatDateForDisplay(null)).toBe("");
    expect(formatDateForDisplay(undefined)).toBe("");
    expect(formatDateForDisplay("not-a-date")).toBe("");
  });

  it("conserve l'heure métier sur les timestamps", () => {
    expect(formatDateTimeForDisplay("2026-09-17T14:35:00+02:00")).toMatch(/^17-09-2026 14:35$/);
  });
});
