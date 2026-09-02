import { describe, expect, it } from "vitest";
import { initialCatalogCountryCode } from "./educationReferenceCountry";

describe("initialCatalogCountryCode — fail-closed multi-pays", () => {
  it("n'impose pas countries[0] ni CD à l'ouverture Superadmin", () => {
    expect(
      initialCatalogCountryCode({
        isCountryAdmin: false,
        visibleCountryCodes: ["BI", "CD"],
      }),
    ).toBe("");
  });

  it("sélectionne uniquement le pays unique d'un Admin Pays", () => {
    expect(
      initialCatalogCountryCode({
        isCountryAdmin: true,
        visibleCountryCodes: ["BI"],
      }),
    ).toBe("BI");
  });
});
