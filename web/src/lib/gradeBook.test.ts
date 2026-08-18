import { describe, expect, it } from "vitest";
import { GradeBookService } from "./gradeBook";
import type { StudentGrade } from "../types";

const riziki = { id: "STU-RIZIKI", className: "2ème A", firstName: "Riziki", lastName: "Test" };
const autre = { id: "STU-AUTRE", className: "2ème A", firstName: "Autre", lastName: "Élève" };

const math14: StudentGrade = {
  id: "g1",
  studentId: "STU-RIZIKI",
  subject: "Mathématiques",
  period: "Trimestre 1",
  value: 14,
  scale: 20,
  evaluationCoefficient: 1,
  gradeStatus: "Saisie",
} as StudentGrade;

describe("GradeBookService — NOTES-UI-P0-001 non-récursion", () => {
  it("getClassRanking se termine quand la classe a des élèves", () => {
    const book = new GradeBookService([riziki, autre], [math14], []);
    const ranking = book.getClassRanking("2ème A", "Trimestre 1");
    expect(ranking).toHaveLength(2);
    expect(ranking[0]?.student.id).toBe("STU-RIZIKI");
    expect(ranking[0]?.average).toBe(14);
    expect(ranking[0]?.rank).toBe(1);
  });

  it("getClassStatistics et getStudentsAtRisk se terminent", () => {
    const book = new GradeBookService([riziki], [math14], []);
    const stats = book.getClassStatistics("2ème A", "Trimestre 1");
    expect(stats.classAverage).toBe(14);
    expect(stats.bestAverage).toBe(14);
    expect(book.getStudentsAtRisk("2ème A", 10, "Trimestre 1")).toEqual([]);
  });

  it("getStudentAverage demande le rang sans reboucler", () => {
    const book = new GradeBookService([riziki, autre], [math14], []);
    const result = book.getStudentAverage("STU-RIZIKI", "Trimestre 1");
    expect(result.average).toBe(14);
    expect(result.rank).toBe(1);
    expect(result.rankLabel).toBe("1e / 2");
  });

  it("période vide = aucun filtre (toutes les périodes)", () => {
    const book = new GradeBookService([riziki], [math14], []);
    expect(book.getClassRanking("2ème A", "").map((row) => row.average)).toEqual([14]);
    expect(book.getStudentAverageValue("STU-RIZIKI", "")).toBe(14);
  });

  it("formule même matière: (14×1 + 10×2) / 3 = 11.33", () => {
    const grades = [
      { ...math14, id: "a", evaluationCoefficient: 1, value: 14 },
      { ...math14, id: "b", evaluationCoefficient: 2, value: 10 },
    ] as StudentGrade[];
    const book = new GradeBookService([riziki], grades, []);
    expect(book.getSubjectAverage("STU-RIZIKI", "Mathématiques", "Trimestre 1").average).toBeCloseTo(
      11.333,
      3,
    );
  });
});
