import { describe, expect, it } from "vitest";
import type { School } from "../types";
import {
  classifySchoolDuplicates,
  CROSS_COUNTRY_CONTACT_MATCH,
  DUPLICATE_CONTACT,
  DUPLICATE_STRONG,
  findPotentialDuplicates,
} from "./schoolModule";

const kanyosha = {
  code: "BI-2026-0001",
  publicId: "BI-EK-26-001",
  name: "Ecole Kanyosha",
  city: "Muha",
  country: "Burundi",
  countryCode: "BI",
  email: "contact@somafrik.app",
  phone: "9090909",
} as School;

const baraka = {
  name: "Institut Baraka",
  city: "Bukavu",
  country: "RDC",
  countryCode: "CD",
  email: "contact@somafrik.app",
  phone: "9090909",
} as School;

describe("findPotentialDuplicates — scope pays", () => {
  it("ne classe pas Kanyosha (BI) comme doublon fort d'un établissement RDC au contact générique", () => {
    expect(classifySchoolDuplicates(baraka, [kanyosha])).toEqual([]);
    expect(findPotentialDuplicates(baraka, [kanyosha])).toEqual([]);
  });

  it("signale un doublon fort pour le même nom et la même ville dans le même pays", () => {
    const existing = {
      ...baraka,
      code: "CD-2026-0008",
      email: "autre@school.cd",
      phone: "+243990111222",
    } as School;
    const matches = findPotentialDuplicates(baraka, [existing]);
    expect(matches).toHaveLength(1);
    expect(matches[0].level).toBe(DUPLICATE_STRONG);
    expect(matches[0].reasons[0]).toMatch(/nom et ville/i);
  });

  it("signale un contact unique dans le même pays, pas en cross-country", () => {
    const existingCd = {
      code: "CD-2026-0009",
      name: "Lycée Autre",
      city: "Goma",
      country: "RDC",
      countryCode: "CD",
      email: "unique@school.cd",
      phone: "+243990000111",
    } as School;
    const draft = { ...baraka, email: "unique@school.cd", phone: "+243990000111" } as School;
    expect(findPotentialDuplicates(draft, [existingCd])[0]?.level).toBe(DUPLICATE_CONTACT);
    expect(classifySchoolDuplicates(draft, [kanyosha, { ...kanyosha, email: "unique@school.cd" }])[0]?.level).toBe(
      CROSS_COUNTRY_CONTACT_MATCH,
    );
    expect(findPotentialDuplicates(draft, [{ ...kanyosha, email: "unique@school.cd" }])).toEqual([]);
  });
});
