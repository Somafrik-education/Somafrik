import { describe, expect, it } from "vitest";
import {
  getStudentLoginIdentifier,
  isStudentCanonicalCode,
  resolveStudentMatricule,
  generateStudentMatricule,
} from "./entityIdentifiers";

describe("identifiant canonique élève", () => {
  it("matricule = identifiant de connexion", () => {
    expect(isStudentCanonicalCode("CD-IN-EL-26-001")).toBe(true);
    expect(getStudentLoginIdentifier("CD-IN-EL-26-001")).toBe("CD-IN-EL-26-001");
    expect(resolveStudentMatricule({ matricule: "CD-IN-EL-26-001" }, "CD-2026-0001")).toEqual({
      matricule: "CD-IN-EL-26-001",
      publicId: "CD-IN-EL-26-001",
      loginIdentifier: "CD-IN-EL-26-001",
    });
  });

  it("ne génère plus de matricule côté Web", () => {
    expect(isStudentCanonicalCode("ELE-0001")).toBe(false);
    expect(() => generateStudentMatricule("CD-2026-0001", [])).toThrow(/PostgreSQL/);
  });
});
