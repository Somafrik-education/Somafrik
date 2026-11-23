import { canonicalWeightedAverage, type CanonicalGrade } from "./evaluationsV2";

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}


/**
 * Aligne le périmètre de calcul sur GradeBookService.notesForStudent :
 * la période demandée exclut les autres périodes, mais conserve les anciennes
 * notes dont la période est absente (compatibilité backend).
 */
export function notesForAveragePeriod(notes: CanonicalGrade[], period?: string): CanonicalGrade[] {
  if (!period) return notes;
  return notes.filter((note) => !String(note.period ?? "").trim() || String(note.period) === period);
}

export function averagePeriodOptions(notes: CanonicalGrade[]): string[] {
  return [...new Set(notes.map((note) => String(note.period ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
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
  period?: string,
): { available: boolean; average: number | null; totalCourseCoefficients: number; displayScale: number } {
  const periodNotes = notesForAveragePeriod(notes, period);
  const subjects = [...new Set(periodNotes.map((note) => String(note.subject ?? "").trim()).filter(Boolean))];
  let weighted = 0;
  let totalCourseCoefficients = 0;

  for (const subject of subjects) {
    const subjectNotes = periodNotes.filter((note) => normalizeKey(note.subject) === normalizeKey(subject));
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

export function courseOptionsFromNotes(notes: CanonicalGrade[], period?: string): string[] {
  return [...new Set(notesForAveragePeriod(notes, period).map((note) => String(note.subject ?? "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}

/** Moyenne canonique d'un seul cours : pondération evaluationCoefficient uniquement. */
export function canonicalCourseAverage(notes: CanonicalGrade[], subject: string, period?: string) {
  const wanted = normalizeKey(subject);
  const subjectNotes = notesForAveragePeriod(notes, period).filter((note) => normalizeKey(note.subject) === wanted);
  return canonicalWeightedAverage(subjectNotes, { displayScale: 20 });
}

/** Format de restitution /20, parité avec le bulletin Web à deux décimales. */
export function formatStudentNotesAverage(average: number | null): string {
  return average !== null && Number.isFinite(average) ? average.toFixed(2) : "—";
}
