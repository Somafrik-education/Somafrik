import { canonicalWeightedAverage, type CanonicalGrade } from "./evaluationsV2";

type CourseRow = {
  name?: string;
  className?: string;
  coefficient?: number;
};

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function courseCoefficientForSubject(
  courses: CourseRow[],
  subject: string,
  className?: string,
): number {
  const subjectKey = normalizeKey(subject);
  const classKey = normalizeKey(className);
  const course = courses.find((row) => {
    if (normalizeKey(row.name) !== subjectKey) return false;
    const rowClass = normalizeKey(row.className);
    return !classKey || !rowClass || rowClass === classKey;
  });
  const coefficient = Number(course?.coefficient ?? 1);
  return Number.isFinite(coefficient) && coefficient > 0 ? coefficient : 1;
}

/**
 * Formule canonique backend/Web staff :
 * 1) moyenne de chaque cours pondérée par evaluationCoefficient ;
 * 2) moyenne générale pondérée par le coefficient du cours.
 */
export function canonicalStudentGeneralAverage(
  notes: CanonicalGrade[],
  courses: CourseRow[],
  className?: string,
): { available: boolean; average: number | null; totalCourseCoefficients: number; displayScale: number } {
  const subjects = [...new Set(notes.map((note) => String(note.subject ?? "").trim()).filter(Boolean))];
  let weighted = 0;
  let totalCourseCoefficients = 0;

  for (const subject of subjects) {
    const subjectNotes = notes.filter((note) => normalizeKey(note.subject) === normalizeKey(subject));
    const subjectAverage = canonicalWeightedAverage(subjectNotes, { displayScale: 20 });
    if (!subjectAverage.available || subjectAverage.average == null) continue;
    const courseCoefficient = courseCoefficientForSubject(courses, subject, className);
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
