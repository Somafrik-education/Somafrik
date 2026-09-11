import { canonicalWeightedAverage, type CanonicalGrade } from "./evaluationsV2";

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function courseCoefficientFromNotes(notes: CanonicalGrade[]): number {
  const fromNote = notes.find((note) => Number(note.coefficient) > 0);
  const coefficient = Number(fromNote?.coefficient ?? 1);
  return Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 1;
}

/**
 * Formule canonique backend/Web staff, à partir des notes /api/notes uniquement :
 * 1) moyenne de chaque cours pondérée par evaluationCoefficient ;
 * 2) moyenne générale pondérée par coefficient (coefficient du cours porté par la note).
 *
 * Ne consomme pas le catalogue de cours établissement.
 */
export function canonicalStudentGeneralAverage(
  notes: CanonicalGrade[],
): { available: boolean; average: number | null; totalCourseCoefficients: number; displayScale: number } {
  const subjects = [...new Set(notes.map((note) => String(note.subject ?? "").trim()).filter(Boolean))];
  let weighted = 0;
  let totalCourseCoefficients = 0;

  for (const subject of subjects) {
    const subjectNotes = notes.filter((note) => normalizeKey(note.subject) === normalizeKey(subject));
    const subjectAverage = canonicalWeightedAverage(subjectNotes, { displayScale: 20 });
    if (!subjectAverage.available || subjectAverage.average == null) continue;
    const courseCoefficient = courseCoefficientFromNotes(subjectNotes);
    weighted += subjectAverage.average * courseCoefficient;
    totalCourseCoefficients += courseCoefficient;
  }

  if (!totalCourseCoefficients) {
    return { available: false, average: null, totalCourseCoefficients: 0, displayScale: 20 };
  }

  return {
    available: true,
    average: weighted / totalCourseCoefficients,
    totalCourseCoefficients,
    displayScale: 20,
  };
}
