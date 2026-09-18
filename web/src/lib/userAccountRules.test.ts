import { describe, expect, it } from "vitest";
import { validateAccountSecret, validatePasswordPolicy } from "./userAccountRules";

describe("LOT 0 — PARITY-012 validateAccountSecret", () => {
  it("refuse un mot de passe trop court ou sans lettre/chiffre", () => {
    expect(validatePasswordPolicy("abcdef")).toMatch(/8 caractères/);
    expect(validateAccountSecret("abcdef1")).toMatch(/8 caractères/);
    expect(validateAccountSecret("password")).toMatch(/chiffre/);
    expect(validateAccountSecret("12345678")).toMatch(/lettre/);
  });

  it("accepte un mot de passe 8+lettre+chiffre", () => {
    expect(validateAccountSecret("Pass1234")).toBeNull();
  });

  it("accepte un PIN 6 chiffres non faible, refuse un PIN faible", () => {
    expect(validateAccountSecret("482917")).toBeNull();
    expect(validateAccountSecret("123456")).toMatch(/trop faible/);
  });
});
