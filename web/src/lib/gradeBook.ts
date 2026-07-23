import type { StudentGrade } from "../types";
import { normalize } from "./format";

type CourseRow = { name?: string; coefficient?: number; className?: string };
type StudentRow = { id?: string; className?: string; name?: string; firstName?: string; lastName?: string };

export interface SubjectAverageRow {
  subject: string;
  average: number;
  coefficient: number;
  gradeCount: number;
}

export interface StudentAverageResult {
  studentId: string;
  average: number;
  totalPoints: number;
  totalCoefficients: number;
  rank: number;
  rankLabel: string;
  subjects: SubjectAverageRow[];
  appreciation: string;
}

export interface ClassRankingRow {
  student: StudentRow;
  average: number;
  rank: number;
  rankLabel: string;
}

export interface ClassGradeStatistics {
  classAverage: number;
  bestAverage: number;
  lowestAverage: number;
  successRate: number;
  top10: ClassRankingRow[];
}

/** D3.6b — aligné sur backend/lib/gradesCanonical (absent/excused/not_submitted/exempt). */
const EXCLUDED_GRADE_STATUSES = new Set([
  "Absente",
  "Justifiée",
  "Dispensée",
  "En attente",
  "Non justifiée",
  "absent",
  "excused",
  "not_submitted",
  "exempt",
]);

function studentDisplayName(student: StudentRow): string {
  const first = String(student.firstName ?? "").trim();
  const last = String(student.lastName ?? "").trim();
  const combined = `${first} ${last}`.trim();
  return combined || String(student.name ?? student.id ?? "Élève");
}

function normalizeToScale20(value: number, scale: number): number {
  if (scale <= 0) return value;
  return scale === 20 ? value : (value / scale) * 20;
}

function gradeCountsInAverage(grade: StudentGrade): boolean {
  if (EXCLUDED_GRADE_STATUSES.has(grade.gradeStatus)) return false;
  return typeof grade.value === "number" && !Number.isNaN(grade.value);
}

function gradeNumericValue(grade: StudentGrade): number {
  return Number(grade.value ?? 0);
}

export class GradeBookService {
  constructor(
    private readonly students: StudentRow[],
    private readonly grades: StudentGrade[],
    private readonly courses: CourseRow[],
  ) {}

  static getAutomaticAppreciation(average: number): string {
    if (average >= 16) return "Excellent";
    if (average >= 14) return "Très Bien";
    if (average >= 12) return "Bien";
    if (average >= 10) return "Assez Bien";
    return "Insuffisant";
  }

  getCourseCoefficient(subject: string): number {
    const course = this.courses.find((item) => normalize(item.name) === normalize(subject));
    return Number(course?.coefficient ?? 1);
  }

  getSubjectAverage(studentId: string, subject: string, period?: string): SubjectAverageRow {
    const subjectGrades = this.grades.filter(
      (grade) =>
        grade.studentId === studentId &&
        normalize(grade.subject) === normalize(subject) &&
        (!period || normalize(grade.period) === normalize(period)) &&
        gradeCountsInAverage(grade),
    );
    const totalWeighted = subjectGrades.reduce((sum, grade) => {
      const scale = grade.scale ?? 20;
      const normalized = normalizeToScale20(gradeNumericValue(grade), scale);
      return sum + normalized * (grade.evaluationCoefficient ?? 1);
    }, 0);
    const totalCoeffs = subjectGrades.reduce((sum, grade) => sum + (grade.evaluationCoefficient ?? 1), 0);

    return {
      subject,
      average: totalCoeffs ? totalWeighted / totalCoeffs : 0,
      coefficient: this.getCourseCoefficient(subject),
      gradeCount: subjectGrades.length,
    };
  }

  getStudentAverage(studentId: string, period?: string): StudentAverageResult {
    const studentGrades = this.grades.filter(
      (grade) =>
        grade.studentId === studentId && (!period || normalize(grade.period) === normalize(period)),
    );
    const subjects = [...new Set(studentGrades.map((grade) => grade.subject))];
    const subjectRows = subjects.map((subject) => this.getSubjectAverage(studentId, subject, period));
    const totalPoints = subjectRows.reduce((sum, row) => sum + row.average * row.coefficient, 0);
    const totalCoefficients = subjectRows.reduce((sum, row) => sum + row.coefficient, 0);
    const average = totalCoefficients ? totalPoints / totalCoefficients : 0;
    const ranking = this.getClassRankingForStudent(studentId, period);

    return {
      studentId,
      average,
      totalPoints,
      totalCoefficients,
      rank: ranking.rank,
      rankLabel: `${ranking.rank}e / ${ranking.total}`,
      subjects: subjectRows,
      appreciation: GradeBookService.getAutomaticAppreciation(average),
    };
  }

  getStudentAverageValue(studentId: string, period?: string): number {
    return this.getStudentAverage(studentId, period).average;
  }

  getClassRanking(className: string, period?: string): ClassRankingRow[] {
    const classStudents = this.students.filter(
      (student) => normalize(student.className) === normalize(className),
    );
    const averages = classStudents
      .map((student) => ({
        student,
        average: this.getStudentAverageValue(String(student.id ?? ""), period),
      }))
      .sort((a, b) => b.average - a.average);

    let lastAverage: number | null = null;
    let lastRank = 0;

    return averages.map((row, index) => {
      if (lastAverage === null || row.average !== lastAverage) {
        lastRank = index + 1;
        lastAverage = row.average;
      }
      return {
        student: row.student,
        average: row.average,
        rank: lastRank,
        rankLabel: `${lastRank}e / ${averages.length}`,
      };
    });
  }

  getClassRankingForStudent(studentId: string, period?: string) {
    const student = this.students.find((item) => item.id === studentId);
    if (!student?.className) return { rank: 0, total: 0 };

    const ranking = this.getClassRanking(String(student.className), period);
    const row = ranking.find((item) => item.student.id === studentId);
    return { rank: row?.rank ?? 0, total: ranking.length };
  }

  getClassStatistics(className: string, period?: string): ClassGradeStatistics {
    const ranking = this.getClassRanking(className, period);
    const averages = ranking.map((row) => row.average);
    const successCount = averages.filter((value) => value >= 10).length;

    return {
      classAverage: averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : 0,
      bestAverage: averages.length ? Math.max(...averages) : 0,
      lowestAverage: averages.length ? Math.min(...averages) : 0,
      successRate: averages.length ? Math.round((successCount / averages.length) * 100) : 0,
      top10: ranking.slice(0, 10),
    };
  }

  getStudentsAtRisk(className: string, threshold = 10, period?: string): ClassRankingRow[] {
    return this.getClassRanking(className, period).filter((row) => row.average > 0 && row.average < threshold);
  }
}

export function formatStudentName(student: StudentRow): string {
  return studentDisplayName(student);
}
