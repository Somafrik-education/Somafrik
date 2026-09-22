import { describe, expect, it } from "vitest";
import { schoolHasLogo, schoolLogoSrc } from "./schoolLogo";

const UPLOADED_AT = "2026-09-12T20:00:00.000Z";

describe("schoolLogo", () => {
  it("n'affiche jamais une URL HTTP saisie par l'utilisateur", () => {
    expect(schoolHasLogo({ logoUrl: "https://cdn.evil.test/logo.png", code: "CD-IN-26-001" })).toBe(false);
    expect(schoolLogoSrc({ logoUrl: "https://cdn.evil.test/logo.png", code: "CD-IN-26-001" })).toBeNull();
  });

  it("n'infère pas un logo depuis hasLogo ou une clé interne sans provenance", () => {
    expect(schoolHasLogo({ hasLogo: true, code: "CD-IN-26-001" })).toBe(false);
    expect(
      schoolHasLogo({
        hasLogo: true,
        logoUrl: "/api/schools/CD-IN-26-001/logo",
        code: "CD-IN-26-001",
      }),
    ).toBe(false);
    expect(
      schoolHasLogo({
        logoUrl: "school-logos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logo.png",
        code: "CD-IN-26-001",
      }),
    ).toBe(false);
  });

  it("clé interne + school_upload sans logoUploadedAt → aucun logo", () => {
    expect(
      schoolHasLogo({
        hasLogo: true,
        logoSource: "school_upload",
        logoUrl: "school-logos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/logo.png",
        code: "CD-IN-26-001",
      }),
    ).toBe(false);
    expect(
      schoolHasLogo({
        hasLogo: true,
        logoSource: "school_upload",
        logoUploadedAt: "not-a-date",
        code: "CD-IN-26-001",
      }),
    ).toBe(false);
  });

  it("school_upload + timestamp mais hasLogo absent/false → aucun logo", () => {
    expect(
      schoolHasLogo({
        logoSource: "school_upload",
        logoUploadedAt: UPLOADED_AT,
        code: "CD-IN-26-001",
      }),
    ).toBe(false);
    expect(
      schoolHasLogo({
        hasLogo: false,
        logoSource: "school_upload",
        logoUploadedAt: UPLOADED_AT,
        code: "CD-IN-26-001",
      }),
    ).toBe(false);
  });

  it("affiche le chemin interne seulement si provenance complète et hasLogo=true", () => {
    expect(
      schoolHasLogo({
        hasLogo: true,
        logoSource: "school_upload",
        logoUploadedAt: UPLOADED_AT,
        code: "CD-IN-26-001",
      }),
    ).toBe(true);
    expect(
      schoolLogoSrc({
        hasLogo: true,
        logoSource: "school_upload",
        logoUploadedAt: UPLOADED_AT,
        loginCode: "CD-IN-26-001",
      }),
    ).toBe("http://localhost:5000/api/schools/CD-IN-26-001/logo");
  });

  it("établissement sans logo → rien", () => {
    expect(schoolHasLogo({ code: "CD-IN-26-001", logoUrl: "" })).toBe(false);
    expect(schoolLogoSrc({ code: "CD-IN-26-001" })).toBeNull();
  });
});
