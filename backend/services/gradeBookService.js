/**
 * D3.6b — Moteur de calcul canonique des moyennes (domaine/backend).
 * Web et mobile doivent consommer ces règles, pas en maintenir une copie divergente.
 */
const {
  gradeCountsInAverage,
  weightedAverage,
  formatAverageForDisplay,
  toGradeStatus,
} = require("../lib/gradesCanonical");

class GradeBookService {
  constructor({ students, notes, courses }) {
    this.students = students;
    this.notes = notes;
    this.courses = courses;
  }

  getStudentAverage(studentId, period) {
    const average = this.getStudentAverageValue(studentId, period);
    const studentNotes = this.notesForStudent(studentId, period);
    const subjects = [...new Set(studentNotes.map((note) => note.subject).filter(Boolean))];
    const subjectRows = subjects.map((subject) => this.getSubjectAverage(studentId, subject, period));
    const totalPoints = subjectRows.reduce((sum, row) => sum + row.average * row.coefficient, 0);
    const totalCoefficients = subjectRows.reduce((sum, row) => sum + row.coefficient, 0);
    const rank = this.getClassRankingForStudent(studentId, period);

    return {
      average,
      averageDisplay: formatAverageForDisplay(average, 2),
      totalPoints,
      totalCoefficients,
      rankLabel: `${rank.rank}e / ${rank.total}`,
      appreciation: this.getAutomaticAppreciation(average),
      subjects: subjectRows,
    };
  }

  getSubjectAverage(studentId, subject, period) {
    const notes = this.notesForStudent(studentId, period).filter((note) => note.subject === subject);
    const course = this.courses.find((item) => item.name === subject);
    const { average, totalCoefficients } = weightedAverage(notes, { displayScale: 20 });

    return {
      subject,
      average,
      averageDisplay: formatAverageForDisplay(average, 2),
      coefficient: Number(course?.coefficient ?? 1),
      gradeCount: notes.filter((note) => gradeCountsInAverage(note)).length,
      totalCoefficients,
    };
  }

  notesForStudent(studentId, period) {
    return this.notes.filter((note) => {
      if (note.studentId !== studentId) return false;
      if (period && String(note.period ?? "").trim() && String(note.period) !== String(period)) {
        return false;
      }
      return true;
    });
  }

  generateReport(studentId, period = "Trimestre 1", status = "Publié") {
    const student = this.students.find((item) => item.id === studentId);
    const average = this.getStudentAverage(studentId, period);

    return {
      id: `BUL-${studentId}-${period.replace(/\s+/g, "-").toUpperCase()}`,
      period,
      status,
      student,
      ...average,
      pdfReady: status === "Publié",
      generatedAt: new Date().toISOString(),
    };
  }

  getClassRanking(className, period) {
    const rows = this.students
      .filter((student) => student.className === className)
      .map((student) => ({
        student,
        average: this.getStudentAverageValue(student.id, period),
        incomplete: this.isSampleIncomplete(student.id, period),
      }))
      .sort((a, b) => b.average - a.average);
    let lastAverage = null;
    let lastRank = 0;

    return rows.map((row, index) => {
      if (lastAverage === null || row.average !== lastAverage) {
        lastAverage = row.average;
        lastRank = index + 1;
      }
      return { ...row, rank: lastRank };
    });
  }

  isSampleIncomplete(studentId, period) {
    const notes = this.notesForStudent(studentId, period);
    if (!notes.length) return true;
    return notes.some((note) => {
      const status = toGradeStatus(note.gradeStatus ?? note.status, note.value != null);
      return status === "not_submitted" || status === "absent";
    });
  }

  getClassRankingForStudent(studentId, period) {
    const student = this.students.find((item) => item.id === studentId);
    if (!student) return { rank: 0, total: 0, incomplete: true };

    const ranking = this.getClassRanking(student.className, period);
    const row = ranking.find((item) => item.student.id === studentId);

    return {
      rank: row?.rank ?? 0,
      total: ranking.length,
      incomplete: Boolean(row?.incomplete),
    };
  }

  getAutomaticAppreciation(average) {
    if (average >= 16) return "Excellent";
    if (average >= 14) return "Très Bien";
    if (average >= 12) return "Bien";
    if (average >= 10) return "Assez Bien";
    return "Insuffisant";
  }

  getStudentAverageValue(studentId, period) {
    const studentNotes = this.notesForStudent(studentId, period);
    const subjects = [...new Set(studentNotes.map((note) => note.subject).filter(Boolean))];
    const subjectRows = subjects.map((subject) => this.getSubjectAverage(studentId, subject, period));
    const totalPoints = subjectRows.reduce((sum, row) => sum + row.average * row.coefficient, 0);
    const totalCoefficients = subjectRows.reduce((sum, row) => sum + row.coefficient, 0);
    return totalCoefficients ? totalPoints / totalCoefficients : 0;
  }
}

module.exports = { GradeBookService };
