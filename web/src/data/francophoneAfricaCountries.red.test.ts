import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");

function read(rel: string) {
  const abs = resolve(ROOT, rel);
  expect(existsSync(abs), `${rel} manquant`).toBe(true);
  return readFileSync(abs, "utf8");
}

/** ISO 3166-1 alpha-2 attendus pour le formulaire public (Afrique francophone commerciale Somafrik). */
export const EXPECTED_FRANCOPHONE_AFRICA_ISO = [
  "BJ",
  "BF",
  "BI",
  "CM",
  "CF",
  "KM",
  "CG",
  "CI",
  "DJ",
  "GA",
  "GN",
  "MG",
  "ML",
  "MR",
  "NE",
  "CD",
  "RW",
  "SN",
  "TD",
  "TG",
] as const;

const EXCLUDED_COMMERCIAL = ["SC", "MU", "GQ", "DZ", "MA", "TN", "GW", "CV"] as const;

describe("RED — pays Afrique francophone (formulaire public)", () => {
  it("expose une source canonique Web dédiée, hors TrialRequestPage", () => {
    const canonical = read("src/data/francophoneAfricaCountries.ts");
    expect(canonical).toMatch(/export const FRANCOPHONE_AFRICA_COUNTRIES/);
    for (const iso of EXPECTED_FRANCOPHONE_AFRICA_ISO) {
      expect(canonical).toContain(`iso: "${iso}"`);
    }
  });

  it("documente les exclusions commerciales (Seychelles, Maurice, Guinée équatoriale, Maghreb, lusophones)", () => {
    const canonical = read("src/data/francophoneAfricaCountries.ts");
    expect(canonical).toMatch(/Seychelles|SC/);
    expect(canonical).toMatch(/Maurice|MU/);
    expect(canonical).toMatch(/Guinée équatoriale|GQ/);
    for (const iso of EXCLUDED_COMMERCIAL) {
      expect(canonical).not.toMatch(new RegExp(`iso:\\s*"${iso}"`));
    }
  });

  it("branche TrialRequestPage sur la source canonique (pas une liste de 10 pays en dur)", () => {
    const page = read("src/pages/TrialRequestPage.tsx");
    expect(page).toMatch(/from ["']\.\.\/data\/francophoneAfricaCountries["']/);
    expect(page).not.toMatch(/const COUNTRIES\s*=\s*\[/);
  });
});
