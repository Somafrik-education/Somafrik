import { describe, expect, it } from "vitest";
import {
  DISPLAY_DATE_HINT,
  formatDateForDisplay,
  formatDateTimeForDisplay,
  isValidDisplayDate,
  parseDisplayDate,
  parsePeriodDate,
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

  it("rejette aussi les dates impossibles dans le parseur historique des périodes", () => {
    expect(parsePeriodDate("29-02-2028")).toBeInstanceOf(Date);
    expect(parsePeriodDate("29-02-2027")).toBeNull();
    expect(parsePeriodDate("31-02-2026")).toBeNull();
    expect(parsePeriodDate("2027-02-29")).toBeNull();
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

  it("convertit les timestamps dans le fuseau local du navigateur", () => {
    const timestamp = "2026-09-17T23:30:00-03:00";
    const local = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    const expected = `${pad(local.getDate())}-${pad(local.getMonth() + 1)}-${local.getFullYear()} ${pad(local.getHours())}:${pad(local.getMinutes())}`;
    expect(formatDateTimeForDisplay(timestamp)).toBe(expected);
  });
});