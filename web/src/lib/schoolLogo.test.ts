import { describe, expect, it } from "vitest";
import { schoolHasLogo, schoolLogoSrc } from "./schoolLogo";

describe("schoolLogo", () => {
  it("n'affiche jamais une URL HTTP saisie par l'utilisateur", () => {
    expect(schoolHasLogo({ logoUrl: "https://cdn.evil.test/logo.png", code: "CD-IN-26-001" })).toBe(false);
    expect(schoolLogoSrc({ logoUrl: "https://cdn.evil.test/logo.png", code: "CD-IN-26-001" })).toBeNull();
  });

  it("affiche le chemin interne généré quand hasLogo", () => {
    expect(schoolHasLogo({ hasLogo: true, code: "CD-IN-26-001" })).toBe(true);
    expect(schoolLogoSrc({ hasLogo: true, loginCode: "CD-IN-26-001" })).toBe(
      "http://localhost:5000/api/schools/CD-IN-26-001/logo",
    );
  });

  it("établissement sans logo → rien", () => {
    expect(schoolHasLogo({ code: "CD-IN-26-001", logoUrl: "" })).toBe(false);
    expect(schoolLogoSrc({ code: "CD-IN-26-001" })).toBeNull();
  });
});
