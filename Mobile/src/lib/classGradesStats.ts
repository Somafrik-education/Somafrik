import { notesForStudent, type CanonicalGrade } from "./evaluationsV2";
import { canonicalStudentGeneralAverage } from "./pedagogyAverage";

export type ClassGradesStudent = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  className?: string;
};

export type ClassGradesRankRow = {
  studentId: string;
  name: string;
  average: number;
  rank: number;
  rankLabel: string;
};

export type ClassGradesStats = {
  classAverage: number;
  bestAverage: number;
  lowestAverage: number;
  successRate: number;
  ranking: ClassGradesRankRow[];
  atRisk: ClassGradesRankRow[];
  empty: boolean;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function studentName(student: ClassGradesStudent) {
  const composed = [student.firstName, student.lastName].filter(Boolean).join(" ").trim();
  return composed || String(student.name ?? "").trim() || student.id;
}

function notesForPeriod(notes: CanonicalGrade[], period?: string | null) {
  const wanted = normalize(period);
  if (!wanted) return notes;
  return notes.filter((note) => normalize(note.period) === wanted);
}

export function classGradesStats(input: {
  students: ClassGradesStudent[];
  notes: CanonicalGrade[];
  className: string;
  period?: string | null;
  allowedClassNames?: string[] | null;
  threshold?: number;
}): ClassGradesStats {
  const empty: ClassGradesStats = {
    classAverage: 0,
    bestAverage: 0,
    lowestAverage: 0,
    successRate: 0,
    ranking: [],
    atRisk: [],
    empty: true,
  };
  const className = normalize(input.className);
  if (!className) return empty;
  if (Array.isArray(input.allowedClassNames)) {
    const allowed = input.allowedClassNames.map(normalize).filter(Boolean);
    if (!allowed.includes(className)) return empty;
  }

  const classStudents = input.students.filter((student) => normalize(student.className) === className);
  const periodNotes = notesForPeriod(input.notes, input.period);
  const threshold = Number(input.threshold ?? 10);

  const rankedSource = classStudents
    .map((student) => {
      const studentNotes = notesForStudent(periodNotes, student.id);
      const computed = canonicalStudentGeneralAverage(studentNotes);
      const average = computed.available && computed.average != null ? computed.average : 0;
      return { student, average };
    })
    .sort((a, b) => b.average - a.average);

  let lastAverage: number | null = null;
  let lastRank = 0;
  const ranking = rankedSource.map((row, index) => {
    if (lastAverage === null || row.average !== lastAverage) {
      lastRank = index + 1;
      lastAverage = row.average;
    }
    return {
      studentId: row.student.id,
      name: studentName(row.student),
      average: row.average,
      rank: lastRank,
      rankLabel: `${lastRank}e / ${rankedSource.length}`,
    };
  });

  const averages = ranking.map((row) => row.average);
  const successCount = averages.filter((value) => value >= threshold).length;
  return {
    classAverage: averages.length ? averages.reduce((sum, value) => sum + value, 0) / averages.length : 0,
    bestAverage: averages.length ? Math.max(...averages) : 0,
    lowestAverage: averages.length ? Math.min(...averages) : 0,
    successRate: averages.length ? Math.round((successCount / averages.length) * 100) : 0,
    ranking,
    atRisk: ranking.filter((row) => row.average > 0 && row.average < threshold),
    empty: periodNotes.length === 0,
  };
}
