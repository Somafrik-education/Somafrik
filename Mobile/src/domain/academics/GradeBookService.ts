import type { Course, NoteItem, Student } from "../../data/catalog";

export type EvaluationType = "Interrogation" | "Devoir" | "Examen" | "Travail pratique" | "Projet";
export type ReportStatus = "Brouillon" | "En validation" | "Validé" | "Publié";

export type AcademicEvaluation = {
  id: string;
  title: string;
  subject: string;
  className: string;
  date: string;
  scale: 10 | 20 | 100 | number;
  type: EvaluationType;
  coefficient: number;
  teacherId: string;
  active: boolean;
};

export type GradeAuditEntry = {
  authorId: string;
  oldValue?: number;
  newValue: number;
  date: string;
};

export type AcademicGrade = NoteItem & {
  evaluationId?: string;
  scale?: number;
  evaluationCoefficient?: number;
  authorId?: string;
  enteredAt?: string;
  gradeStatus?: string;
  status?: string;
  audit?: GradeAuditEntry[];
};

/** D3.6b — aligné sur backend/lib/gradesCanonical (statuts non notés exclus). */
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

function gradeCountsInAverage(grade: AcademicGrade): boolean {
  const status = String(grade.gradeStatus ?? grade.status ?? "").trim();
  if (status && EXCLUDED_GRADE_STATUSES.has(status)) return false;
  return typeof grade.value === "number" && !Number.isNaN(grade.value);
}

export type StudentAverage = {
  studentId: string;
  average: number;
  totalPoints: number;
  totalCoefficients: number;
  rank: number;
  rankLabel: string;
};

export class GradeBookService {
  constructor(
    private readonly students: Student[],
    private readonly grades: AcademicGrade[],
    private readonly courses: Course[],
    private readonly evaluations: AcademicEvaluation[] = []
  ) {}

  validateGrade(value: number, scale = 20) {
    if (Number.isNaN(value) || value < 0 || value > scale) {
      throw new Error(`Note invalide. Valeur autorisée : 0 à ${scale}.`);
    }
  }

  createGrade(input: Omit<AcademicGrade, "id" | "enteredAt" | "audit"> & { authorId: string }) {
    this.validateGrade(input.value, input.scale ?? 20);
    const now = GradeBookService.formatDateTime(new Date());

    return {
      ...input,
      id: `NOTE-${Date.now()}`,
      enteredAt: now,
      audit: [{ authorId: input.authorId, newValue: input.value, date: now }],
    };
  }

  updateGrade(grade: AcademicGrade, newValue: number, authorId: string) {
    this.validateGrade(newValue, grade.scale ?? 20);
    const now = GradeBookService.formatDateTime(new Date());

    return {
      ...grade,
      value: newValue,
      enteredAt: now,
      audit: [
        ...(grade.audit ?? []),
        { authorId, oldValue: grade.value, newValue, date: now },
      ],
    };
  }

  getSubjectAverage(studentId: string, subject: string) {
    const subjectGrades = this.grades.filter((grade) => grade.studentId === studentId && grade.subject === subject);
    return this.computeAverage(subjectGrades, subject);
  }

  getStudentAverage(studentId: string): StudentAverage {
    const studentGrades = this.grades.filter((grade) => grade.studentId === studentId);
    const groupedSubjects = [...new Set(studentGrades.map((grade) => grade.subject))];
    const subjectRows = groupedSubjects.map((subject) => this.getSubjectAverage(studentId, subject));
    const totalPoints = subjectRows.reduce((sum, row) => sum + row.average * row.coefficient, 0);
    const totalCoefficients = subjectRows.reduce((sum, row) => sum + row.coefficient, 0);
    const average = totalCoefficients ? totalPoints / totalCoefficients : 0;
    const ranking = this.getClassRankingForStudent(studentId);

    return {
      studentId,
      average,
      totalPoints,
      totalCoefficients,
      rank: ranking.rank,
      rankLabel: `${ranking.rank}e / ${ranking.total}`,
    };
  }

  getClassRanking(className: string) {
    const classStudents = this.students.filter((student) => student.className === className);
    const averages = classStudents
      .map((student) => ({ student, average: this.getStudentAverageValue(student.id) }))
      .sort((a, b) => b.average - a.average);

    let lastAverage: number | null = null;
    let lastRank = 0;

    return averages.map((row, index) => {
      if (lastAverage === null || row.average !== lastAverage) {
        lastRank = index + 1;
        lastAverage = row.average;
      }

      return {
        ...row,
        rank: lastRank,
        rankLabel: `${lastRank}e / ${averages.length}`,
      };
    });
  }

  getClassStatistics(className: string) {
    const ranking = this.getClassRanking(className);
    const averages = ranking.map((row) => row.average);
    const successCount = averages.filter((average) => average >= 10).length;

    return {
      classAverage: averages.length ? averages.reduce((sum, average) => sum + average, 0) / averages.length : 0,
      bestAverage: averages.length ? Math.max(...averages) : 0,
      lowestAverage: averages.length ? Math.min(...averages) : 0,
      successRate: averages.length ? Math.round((successCount / averages.length) * 100) : 0,
      top10: ranking.slice(0, 10),
    };
  }

  generateReport(studentId: string, period = "Trimestre 1", status: ReportStatus = "Brouillon") {
    const student = this.students.find((item) => item.id === studentId);
    const averages = this.getStudentAverage(studentId);
    const subjectRows = [...new Set(this.grades.filter((grade) => grade.studentId === studentId).map((grade) => grade.subject))]
      .map((subject) => this.getSubjectAverage(studentId, subject));

    return {
      id: `BUL-${studentId}-${period.replace(/\s+/g, "-").toUpperCase()}`,
      student,
      period,
      status,
      subjectRows,
      average: averages.average,
      totalPoints: averages.totalPoints,
      totalCoefficients: averages.totalCoefficients,
      rankLabel: averages.rankLabel,
      appreciation: this.getAutomaticAppreciation(averages.average),
      pdfReady: status === "Publié",
      generatedAt: GradeBookService.formatDateTime(new Date()),
    };
  }

  getAutomaticAppreciation(average: number) {
    if (average >= 16) return "Excellent";
    if (average >= 14) return "Très Bien";
    if (average >= 12) return "Bien";
    if (average >= 10) return "Assez Bien";
    return "Insuffisant";
  }

  private computeAverage(grades: AcademicGrade[], subject: string) {
    const courseCoefficient = this.getCourseCoefficient(subject);
    const eligible = grades.filter((grade) => gradeCountsInAverage(grade));
    const totalWeighted = eligible.reduce((sum, grade) => {
      const scale = grade.scale ?? 20;
      const normalizedValue = scale === 20 ? grade.value : (grade.value / scale) * 20;
      return sum + normalizedValue * (grade.evaluationCoefficient ?? 1);
    }, 0);
    const totalEvaluationCoefficients = eligible.reduce(
      (sum, grade) => sum + (grade.evaluationCoefficient ?? 1),
      0,
    );
    const average = totalEvaluationCoefficients ? totalWeighted / totalEvaluationCoefficients : 0;

    return {
      subject,
      average,
      coefficient: courseCoefficient,
    };
  }

  private getCourseCoefficient(subject: string) {
    return this.courses.find((course) => course.name === subject)?.coefficient ?? 1;
  }

  private getStudentAverageValue(studentId: string) {
    const studentGrades = this.grades.filter((grade) => grade.studentId === studentId);
    if (!studentGrades.length) return 0;

    const groupedSubjects = [...new Set(studentGrades.map((grade) => grade.subject))];
    const subjectRows = groupedSubjects.map((subject) => this.getSubjectAverage(studentId, subject));
    const totalPoints = subjectRows.reduce((sum, row) => sum + row.average * row.coefficient, 0);
    const totalCoefficients = subjectRows.reduce((sum, row) => sum + row.coefficient, 0);

    return totalCoefficients ? totalPoints / totalCoefficients : 0;
  }

  private getClassRankingForStudent(studentId: string) {
    const student = this.students.find((item) => item.id === studentId);
    if (!student) return { rank: 0, total: 0 };

    const ranking = this.getClassRanking(student.className);
    const row = ranking.find((item) => item.student.id === studentId);

    return { rank: row?.rank ?? 0, total: ranking.length };
  }

  private static formatDateTime(date: Date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}-${month}-${date.getFullYear()} ${hour}:${minutes}`;
  }
}
