import { describe, it, expect } from "vitest";

import {
  generateStudentMatricule,
  getStudentLoginIdentifier,
  isLegacyStudentMatricule,
  repairStudentMatricules,
} from "../src/lib/entityIdentifiers";

describe("generateStudentMatricule", () => {
  it("génère ELE-établissement-année-séquence pour CD-2026-0001", () => {
    const matricule = generateStudentMatricule("CD-2026-0001", []);
    expect(matricule).toBe("ELE-0001-0001-000001");
  });

  it("incrémente la séquence pour le même établissement", () => {
    const students = [{ schoolCode: "CD-2026-0001", matricule: "ELE-0001-0001-000001" }];
    expect(generateStudentMatricule("CD-2026-0001", students)).toBe("ELE-0001-0001-000002");
  });

  it("détecte les matricules legacy", () => {
    expect(isLegacyStudentMatricule("STUDENTS-c04af08e-1eb9-4bdb-a448-624ec2384e04")).toBe(true);
    expect(isLegacyStudentMatricule("ELE-0001-0001-000001")).toBe(false);
  });

  it("répare les matricules legacy", () => {
    const students = [
      {
        id: "STUDENTS-a",
        schoolCode: "CD-2026-0001",
        matricule: "STUDENTS-a",
        firstName: "Esther",
        name: "OKITO",
      },
      {
        id: "STUDENTS-b",
        schoolCode: "CD-2026-0001",
        matricule: "STUDENTS-b",
        firstName: "Hope",
        name: "OKITO",
      },
    ];
    const repaired = repairStudentMatricules(students, "CD-2026-0001");
    expect(repaired[0]?.matricule).toBe("ELE-0001-0001-000001");
    expect(repaired[1]?.matricule).toBe("ELE-0001-0001-000002");
  });

  it("extrait l'identifiant court de connexion", () => {
    expect(getStudentLoginIdentifier("ELE-0001-0001-000042")).toBe("ELE-0042");
  });
});
