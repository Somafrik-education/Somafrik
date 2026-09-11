import { describe, expect, it } from "vitest";
import {
  composeClassPreviewName,
  countCanonicalClasses,
  countStudentsWithoutClass,
  filterCanonicalClasses,
  getClassDisplayName,
  selectCurrentAcademicYear,
} from "./schoolingTruth";

describe("schoolingTruth", () => {
  it("ignore les classes synthétiques CLASS- et exige un identifiant canonique", () => {
    expect(
      filterCanonicalClasses([
        { id: "CLASS-6ème A", name: "6ème A" },
        { id: "cls-1", classCode: "CLS-1", name: "6ème A" },
        { id: "cls-2", publicId: "CLASS-fantome", name: "Fantôme" },
      ]).map((row) => row.id),
    ).toEqual(["cls-1"]);
    expect(
      countCanonicalClasses([
        { id: "CLASS-X", name: "X" },
        { id: "cls-1", classCode: "CLS-1" },
        { id: "cls-2", classCode: "CLS-2" },
      ]),
    ).toBe(2);
  });

  it("sélectionne l'année scolaire courante sans fallback inventé", () => {
    expect(
      selectCurrentAcademicYear([
        { name: "2024-2025", isCurrent: false },
        { name: "2025-2026", isCurrent: true },
      ])?.name,
    ).toBe("2025-2026");
    expect(selectCurrentAcademicYear([])).toBeNull();
    expect(selectCurrentAcademicYear([{ name: "2025-2026", status: "current" }])?.name).toBe("2025-2026");
  });

  it("compte les élèves sans classe affectée", () => {
    expect(countStudentsWithoutClass([{ className: "6ème A" }, { className: "" }, { classCode: "CLS-1" }])).toBe(1);
  });

  it("conserve le nom de classe métier", () => {
    expect(getClassDisplayName({ name: "1ère A CD02", groupCode: "CD02" })).toBe("1ère A");
    expect(composeClassPreviewName({ levelName: "1ère Primaire", groupCode: "A" })).toBe("1ère Primaire A");
  });
});
