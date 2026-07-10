import { describe, it, expect } from "vitest";

import { validateGradeValue } from "../src/lib/evaluations";
import { GradeBookService } from "../src/lib/gradeBook";
import type { StudentGrade } from "../src/types";

describe("evaluations — notes", () => {
  it("accepte une note valide", () => {
    expect(validateGradeValue(15, 20)).toBeNull();
  });

  it("rejette une note vide/non numérique", () => {
    expect(validateGradeValue(Number.NaN, 20)).toMatch(/nombre/i);
  });

  it("rejette une note négative", () => {
    expect(validateGradeValue(-1, 20)).toMatch(/négative/i);
  });

  it("rejette une note supérieure au barème", () => {
    expect(validateGradeValue(21, 20)).toMatch(/barème/i);
  });
});

describe("gradeBook — moyennes", () => {
  const grades: StudentGrade[] = [
    {
      id: "G1",
      studentId: "STU-1",
      subject: "Maths",
      value: 16,
      scale: 20,
      evaluationCoefficient: 2,
      gradeStatus: "Validée",
      period: "T1",
    },
    {
      id: "G2",
      studentId: "STU-1",
      subject: "Français",
      value: 12,
      scale: 20,
      evaluationCoefficient: 1,
      gradeStatus: "Validée",
      period: "T1",
    },
    {
      id: "G3",
      studentId: "STU-2",
      subject: "Maths",
      value: 10,
      scale: 20,
      evaluationCoefficient: 1,
      gradeStatus: "Validée",
      period: "T1",
    },
  ];

  it("calcule la moyenne par matière", () => {
    const service = new GradeBookService(
      [{ id: "STU-1", className: "6A" }],
      grades,
      [{ name: "Maths", coefficient: 2 }, { name: "Français", coefficient: 1 }],
    );
    const maths = service.getSubjectAverage("STU-1", "Maths", "T1");
    const french = service.getSubjectAverage("STU-1", "Français", "T1");
    expect(maths.average).toBe(16);
    expect(french.average).toBe(12);
    expect(maths.coefficient).toBe(2);
  });

  it("attribue la mention correcte", () => {
    expect(GradeBookService.getAutomaticAppreciation(16)).toBe("Excellent");
    expect(GradeBookService.getAutomaticAppreciation(12)).toBe("Bien");
    expect(GradeBookService.getAutomaticAppreciation(8)).toBe("Insuffisant");
  });
});
