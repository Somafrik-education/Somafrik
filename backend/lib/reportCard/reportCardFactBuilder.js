"use strict";

/**
 * BULLETIN-PUBLISH-01 — notes réelles → faits canoniques du moteur
 * somafrik.report_card.v1 (profils à règles par matière + `fact_sources`).
 *
 * Pur et déterministe. Chaque note est rattachée sans ambiguïté à :
 * établissement, élève inscrit, classe / année, cours, matière ou sous-matière,
 * évaluation, période (T1…), composante (TJ/EX), valeur et maximum.
 * Toute donnée non rattachable produit une anomalie identifiée ; aucune
 * conversion silencieuse, aucune note manquante convertie en zéro.
 *
 * Agrégation d'une cellule (élève × matière × période × composante) :
 * - weighted_average : Σ(note / max × coef) / Σ coef × maximum de la cellule
 *   (règle canonique gradesCanonical.weightedAverage) ;
 * - sum : Σ notes, exigeant Σ maxima des évaluations = maximum de la cellule,
 *   coefficients à 1 et toutes les notes saisies (sinon anomalie / MISSING).
 */

const { weightedAverage, gradeCountsInAverage } = require("../gradesCanonical");
const {
  resolveSubjectComponentRule,
  normalizeEvaluationTypeCode,
  normalizeTermName,
} = require("./academicRuleProfile");

const BLOCKING = "blocking";
const WARNING = "warning";
const MAX_EPSILON = 1e-9;

class ReportCardFactBuilderError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ReportCardFactBuilderError";
    this.code = code;
  }
}

function asKey(value) {
  return value == null ? "" : String(value).trim();
}

function indexSources(profile) {
  const sources = profile.fact_sources;
  if (!Array.isArray(profile.subjects) || !sources) {
    throw new ReportCardFactBuilderError("PROFILE_NOT_PUBLISHABLE");
  }
  const componentByType = new Map();
  for (const [componentId, entry] of Object.entries(sources.components)) {
    for (const code of entry.evaluation_types) componentByType.set(code, componentId);
  }
  const periodByTerm = new Map();
  for (const [periodId, entry] of Object.entries(sources.periods)) {
    for (const name of entry.term_names) periodByTerm.set(name, periodId);
  }
  return { componentByType, periodByTerm, aggregationOf: (componentId) => sources.components[componentId].aggregation };
}

function gradePublication(row) {
  const cancelled = row.evaluation_status === "archived" || row.evaluation_active === false;
  if (cancelled) return "CANCELLED";
  const published = asKey(row.publication_status) === "published" && row.evaluation_status === "published";
  return published ? "PUBLISHED" : "UNPUBLISHED";
}

function issue(code, severity, where = {}) {
  const out = { code, severity };
  for (const key of ["student_id", "subject_id", "period_id", "score_component_id", "grade_id", "evaluation_id", "evaluation_title", "term_name", "evaluation_type"]) {
    if (where[key] != null && where[key] !== "") out[key] = String(where[key]);
  }
  return out;
}

function compareIssue(a, b) {
  const keys = ["severity", "code", "student_id", "subject_id", "period_id", "score_component_id", "grade_id"];
  for (const key of keys) {
    const diff = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
    if (diff) return diff;
  }
  return 0;
}

function aggregateCell(rows, { aggregation, cellMax }) {
  const statuses = rows.map(gradePublication);
  if (statuses.every((status) => status === "CANCELLED")) return { fact_status: "CANCELLED", raw_score: null };
  if (statuses.includes("UNPUBLISHED")) return { fact_status: "UNPUBLISHED", raw_score: null };
  const published = rows.filter((_, index) => statuses[index] === "PUBLISHED");
  if (aggregation === "weighted_average") {
    const { average, totalCoefficients } = weightedAverage(
      published.map((row) => ({
        score: row.score == null ? null : Number(row.score),
        value: row.score == null ? null : Number(row.score),
        maxScore: Number(row.max_score),
        coefficient: Number(row.coefficient ?? 1),
        evaluationCoefficient: Number(row.coefficient ?? 1),
        gradeStatus: row.grade_status,
        status: row.grade_status,
      })),
      { displayScale: cellMax }
    );
    return { raw_score: totalCoefficients ? average : null };
  }
  // sum
  if (published.some((row) => Number(row.coefficient ?? 1) !== 1)) return { error: "COEFFICIENT_NOT_SUPPORTED" };
  const maxSum = published.reduce((acc, row) => acc + Number(row.max_score), 0);
  if (Math.abs(maxSum - cellMax) > MAX_EPSILON) return { error: "MAX_INCONSISTENT" };
  const counted = published.map((row) =>
    gradeCountsInAverage({ score: row.score, value: row.score, gradeStatus: row.grade_status, status: row.grade_status })
  );
  if (counted.some((ok) => !ok)) return { raw_score: null };
  return { raw_score: published.reduce((acc, row) => acc + Number(row.score), 0) };
}

/**
 * @param {object} input
 * @param {object} input.profile spécification validée (subjects + fact_sources)
 * @param {string} input.schoolId établissement de la publication
 * @param {string} input.classAcademicYearId année scolaire de la classe
 * @param {string[]} input.periods périodes du périmètre (ordre du profil)
 * @param {Array<{student_uuid, student_code, student_school_id}>} input.cohort inscrits actifs
 * @param {object[]} input.gradeRows notes de la classe (listClassGradeSources)
 * @param {object[]} input.evaluationRows évaluations publiées de la classe, y compris sans note
 */
function buildPublicationFacts({ profile, schoolId, classAcademicYearId, periods, cohort = [], gradeRows = [], evaluationRows = [] } = {}) {
  const tenant = asKey(schoolId);
  if (!tenant) throw new ReportCardFactBuilderError("TENANT_REQUIRED");
  const { componentByType, periodByTerm, aggregationOf } = indexSources(profile);
  const inScope = new Set(periods);
  const issues = [];
  const roster = [];
  const enrolled = new Map();
  for (const student of cohort) {
    if (asKey(student.student_school_id) !== tenant) {
      issues.push(issue("FOREIGN_SCHOOL_DATA", BLOCKING, { student_id: student.student_code }));
      continue;
    }
    enrolled.set(asKey(student.student_uuid), asKey(student.student_code));
    roster.push(asKey(student.student_code));
  }
  const cells = new Map();
  // Vérification globale : même une évaluation publiée sans note doit être auditée.
  const mappedEvaluations = new Map();
  const unmappedEvaluations = new Set();
  for (const row of evaluationRows) {
    const evaluationId = asKey(row.evaluation_id);
    const where = { evaluation_id: evaluationId, evaluation_title: row.evaluation_title, subject_id: row.subject_code };
    if (asKey(row.evaluation_school_id) !== tenant || asKey(row.subject_school_id) !== tenant) {
      issues.push(issue("FOREIGN_SCHOOL_DATA", BLOCKING, where));
      continue;
    }
    if (asKey(row.term_year_id) !== asKey(classAcademicYearId)) {
      issues.push(issue("TERM_NOT_IN_ACADEMIC_YEAR", BLOCKING, where));
      continue;
    }
    const periodId = periodByTerm.get(normalizeTermName(row.term_name));
    if (!periodId) {
      issues.push(issue("PERIOD_UNKNOWN", BLOCKING, { ...where, term_name: row.term_name }));
      continue;
    }
    if (!inScope.has(periodId)) continue;
    where.period_id = periodId;
    const typeCode = normalizeEvaluationTypeCode(row.evaluation_type_code || row.evaluation_type_text);
    const componentId = componentByType.get(typeCode);
    if (!componentId) {
      unmappedEvaluations.add(evaluationId);
      issues.push(issue("EVALUATION_TYPE_UNMAPPED", BLOCKING, { ...where, evaluation_type: typeCode }));
      continue;
    }
    mappedEvaluations.set(evaluationId, { ...where, componentId, typeCode });
  }
  const studentsWithGrades = new Map();
  for (const row of gradeRows) {
    const evaluationId = asKey(row.evaluation_id);
    if (mappedEvaluations.has(evaluationId)) {
      if (!studentsWithGrades.has(evaluationId)) studentsWithGrades.set(evaluationId, new Set());
      studentsWithGrades.get(evaluationId).add(asKey(row.student_uuid));
    }
    const where = { grade_id: row.grade_id, evaluation_id: row.evaluation_id, subject_id: row.subject_code };
    const foreign = [row.grade_school_id, row.student_school_id, row.subject_school_id]
      .concat(row.evaluation_id ? [row.evaluation_school_id] : [])
      .some((value) => asKey(value) !== tenant);
    if (foreign) {
      issues.push(issue("FOREIGN_SCHOOL_DATA", BLOCKING, where));
      continue;
    }
    const studentCode = enrolled.get(asKey(row.student_uuid));
    if (!studentCode) {
      issues.push(issue("ENROLLMENT_INVALID", WARNING, { ...where, student_id: row.student_code }));
      continue;
    }
    where.student_id = studentCode;
    if (asKey(row.term_year_id) !== asKey(classAcademicYearId)) {
      issues.push(issue("TERM_NOT_IN_ACADEMIC_YEAR", BLOCKING, where));
      continue;
    }
    const periodId = periodByTerm.get(normalizeTermName(row.term_name));
    if (!periodId) {
      issues.push(issue("PERIOD_UNKNOWN", BLOCKING, { ...where, term_name: row.term_name }));
      continue;
    }
    if (!inScope.has(periodId)) continue;
    where.period_id = periodId;
    if (!row.evaluation_id) {
      issues.push(issue("GRADE_WITHOUT_EVALUATION", BLOCKING, where));
      continue;
    }
    const typeCode = normalizeEvaluationTypeCode(row.evaluation_type_code || row.evaluation_type_text);
    const componentId = componentByType.get(typeCode);
    if (!componentId) {
      // La classe voit déjà une anomalie nommée pour cette évaluation.
      if (!unmappedEvaluations.has(asKey(row.evaluation_id))) {
        issues.push(issue("EVALUATION_TYPE_UNMAPPED", BLOCKING, { ...where, evaluation_type: typeCode }));
      }
      continue;
    }
    where.score_component_id = componentId;
    const rule = resolveSubjectComponentRule(profile, asKey(row.subject_code), periodId, componentId);
    if (rule.state === "NOT_CONFIGURED") {
      issues.push(issue("SUBJECT_NOT_CONFIGURED", BLOCKING, where));
      continue;
    }
    if (rule.state === "COMPOSITE") {
      issues.push(issue("SUBJECT_IS_COMPOSITE", BLOCKING, where));
      continue;
    }
    if (rule.state === "NOT_APPLICABLE") {
      if (gradePublication(row) === "CANCELLED") continue;
      issues.push(issue("COMPONENT_NOT_APPLICABLE", BLOCKING, where));
      continue;
    }
    if (!row.course_id) {
      issues.push(issue("COURSE_NOT_FOUND", BLOCKING, where));
      continue;
    }
    const key = `${studentCode}\0${row.subject_code}\0${periodId}\0${componentId}`;
    if (!cells.has(key)) cells.set(key, { studentCode, subjectId: asKey(row.subject_code), periodId, componentId, cellMax: rule.max, rows: [] });
    cells.get(key).rows.push(row);
  }
  // Comparer chaque évaluation publiée et mappée à tous les inscrits de la classe.
  for (const [evaluationId, entry] of mappedEvaluations) {
    const rule = resolveSubjectComponentRule(profile, asKey(entry.subject_id), entry.period_id, entry.componentId);
    if (rule.state !== "APPLICABLE") continue;
    const gradedStudents = studentsWithGrades.get(evaluationId) || new Set();
    for (const [studentUuid, studentCode] of enrolled) {
      if (!gradedStudents.has(studentUuid)) {
        issues.push(issue("EVALUATION_GRADE_MISSING", BLOCKING, {
          ...entry, student_id: studentCode, score_component_id: entry.componentId,
          evaluation_type: entry.typeCode,
        }));
      }
    }
  }
  const facts = [];
  for (const cell of [...cells.values()].sort((a, b) =>
    `${a.studentCode}\0${a.subjectId}\0${a.periodId}\0${a.componentId}`.localeCompare(
      `${b.studentCode}\0${b.subjectId}\0${b.periodId}\0${b.componentId}`
    )
  )) {
    const outcome = aggregateCell(cell.rows, { aggregation: aggregationOf(cell.componentId), cellMax: cell.cellMax });
    const where = { student_id: cell.studentCode, subject_id: cell.subjectId, period_id: cell.periodId, score_component_id: cell.componentId };
    if (outcome.error) {
      issues.push(issue(outcome.error, BLOCKING, where));
      continue;
    }
    const fact = {
      school_id: tenant,
      student_id: cell.studentCode,
      subject_id: cell.subjectId,
      period_id: cell.periodId,
      score_component_id: cell.componentId,
      raw_score: outcome.raw_score,
    };
    if (outcome.fact_status) fact.fact_status = outcome.fact_status;
    facts.push(fact);
  }
  return { facts, roster: roster.sort(), issues: issues.sort(compareIssue) };
}

module.exports = {
  BLOCKING,
  WARNING,
  ReportCardFactBuilderError,
  buildPublicationFacts,
};
