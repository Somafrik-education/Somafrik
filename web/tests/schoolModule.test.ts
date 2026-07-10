import { describe, it, expect } from "vitest";

import { generateSchoolCode, validateSchoolForm } from "../src/lib/schoolModule";

function validSchool(overrides: Record<string, unknown> = {}) {
  return {
    name: "École Test",
    type: "Collège",
    country: "RDC",
    city: "Kinshasa",
    phone: "+243820000000",
    email: "contact@ecole.test",
    principalName: "Directeur Test",
    code: "CD-2026-0001",
    ...overrides,
  };
}

describe("schoolModule", () => {
  it("génère un code établissement au format CODEPAYS-AAAA-0001", () => {
    const year = new Date().getFullYear();
    expect(generateSchoolCode("CD", [])).toBe(`CD-${year}-0001`);
    expect(generateSchoolCode("CD", [{ code: `CD-${year}-0005` }])).toBe(`CD-${year}-0006`);
  });

  it("accepte des données établissement valides", () => {
    expect(validateSchoolForm(validSchool(), [], { isNew: true })).toBeNull();
  });

  it("rejette un nom vide", () => {
    expect(validateSchoolForm(validSchool({ name: "" }), [])).toMatch(/nom/i);
  });

  it("rejette un pays vide", () => {
    expect(validateSchoolForm(validSchool({ country: "" }), [])).toMatch(/pays/i);
  });

  it("rejette un email invalide", () => {
    expect(validateSchoolForm(validSchool({ email: "pas-un-email" }), [])).toMatch(/email/i);
  });

  it("rejette un code déjà existant", () => {
    expect(
      validateSchoolForm(validSchool(), [{ code: "CD-2026-0001" }], { isNew: true }),
    ).toMatch(/existe déjà/i);
  });
});
