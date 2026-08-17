import { describe, expect, it } from "vitest";
import { getCountryCodeFromScope, resolveCountryScopeFromSchool } from "./format";

describe("getCountryCodeFromScope", () => {
  it("mappe le nom accentué RDC vers CD", () => {
    expect(getCountryCodeFromScope("République Démocratique du Congo")).toBe("CD");
    expect(getCountryCodeFromScope("RDC")).toBe("CD");
    expect(getCountryCodeFromScope("CD")).toBe("CD");
  });

  it("mappe Burundi vers BI sans défaut CD", () => {
    expect(getCountryCodeFromScope("Burundi")).toBe("BI");
    expect(getCountryCodeFromScope("BI")).toBe("BI");
    expect(getCountryCodeFromScope("")).toBe("");
  });
});

describe("resolveCountryScopeFromSchool", () => {
  it("retourne le scope canonique, jamais le nom brut non parsable", () => {
    expect(
      resolveCountryScopeFromSchool({
        country: "République Démocratique du Congo",
        countryCode: "CD",
      }),
    ).toBe("RDC");
    expect(resolveCountryScopeFromSchool({ country: "Burundi", countryCode: "BI" })).toBe("BI");
  });
});
