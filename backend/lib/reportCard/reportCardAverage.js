"use strict";

/**
 * Calcule le récapitulatif d'un bulletin depuis les grades de la même période.
 * Uniquement les notes éligibles et pondérées selon GradeBookService.
 * Ne modifie aucun bulletin ni aucune note stockée.
 */
const { GradeBookService } = require("../../services/gradeBookService");
const { gradeCountsInAverage } = require("../gradesCanonical");

function computeReportCardAverage(rows, studentId) {
  const notes = (Array.isArray(rows) ? rows : []).map((row) => ({
    studentId,
    subject: String(row.subject_name ?? "").trim(),
    value: row.score === null || row.score === undefined ? null : Number(row.score),
    scale: Number(row.max_score ?? 20),
    evaluationCoefficient: Number(row.evaluation_coefficient ?? 1),
    coefficient: Number(row.subject_coefficient ?? 1),
    gradeStatus: row.grade_status,
  }));
  if (!notes.some((note) => note.subject && gradeCountsInAverage(note))) return null;
  const book = new GradeBookService({
    students: [{ id: studentId, className: "" }],
    notes,
    courses: [],
  });
  const average = book.getStudentAverageValue(studentId);
  return Number.isFinite(average) ? Number(average.toFixed(2)) : null;
}

module.exports = { computeReportCardAverage };
