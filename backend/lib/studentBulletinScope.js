"use strict";

/**
 * BULLETIN-SEC-01 — périmètre du bulletin historique d'un élève
 * (GET /api/students/:id/report et /report.pdf).
 *
 * Un bulletin présenté comme « Publié » ne contient que :
 * - des notes publiées, selon la règle bulletin existante (LOT 9,
 *   reportCardFactsStore.listFacts) : grades.publication_status = 'published'
 *   et évaluation absente (note héritée) ou publiée ; une évaluation inactive
 *   est exclue, comme pour la lecture Parent (filterNotesForPrincipal) ;
 * - des notes et des camarades de l'établissement propriétaire de l'élève et
 *   de sa classe (identifiant de classe quand il est connu, sinon nom de classe
 *   dans ce seul établissement) ;
 * - l'identité de cet établissement.
 *
 * Échec sécurisé : établissement introuvable ⇒ aucun bulletin ; statut
 * d'évaluation inconnu ⇒ note exclue.
 */

const { isPublishedEvaluationStatus } = require("./gradesCanonical");

const BULLETIN_SCHOOL_UNRESOLVED = "BULLETIN_SCHOOL_UNRESOLVED";

class StudentBulletinScopeError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.name = "StudentBulletinScopeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function asKey(value) {
  return String(value ?? "").trim();
}

function upperKey(value) {
  return asKey(value).toUpperCase();
}

function schoolCodes(school) {
  return new Set(
    [school?.code, school?.loginCode, school?.legacySchoolCode, school?.publicId]
      .map(upperKey)
      .filter(Boolean),
  );
}

/** Établissement propriétaire : identifiant UUID d'abord, code seulement à défaut. */
function resolveOwnerSchool(schools, student) {
  const list = Array.isArray(schools) ? schools : [];
  const schoolId = asKey(student?.schoolId);
  if (schoolId) {
    return list.find((school) => asKey(school?.id) === schoolId) ?? null;
  }
  const code = upperKey(student?.schoolCode);
  if (!code) return null;
  const matches = list.filter((school) => schoolCodes(school).has(code));
  return matches.length === 1 ? matches[0] : null;
}

function belongsToSchool(row, school) {
  const rowSchoolId = asKey(row?.schoolId);
  if (rowSchoolId && asKey(school?.id)) return rowSchoolId === asKey(school.id);
  const rowCode = upperKey(row?.schoolCode);
  return Boolean(rowCode) && schoolCodes(school).has(rowCode);
}

function sameClass(candidate, student, classId) {
  if (classId) return asKey(candidate?.classId) === classId;
  const className = asKey(student?.className);
  return Boolean(className) && asKey(candidate?.className) === className;
}

/**
 * Faits de publication d'une note. La source PostgreSQL les fournit
 * (`bulletinPublication`) ; sinon ils sont déduits de la liste des évaluations.
 */
function publicationFacts(note, evaluationsById) {
  if (note?.bulletinPublication && typeof note.bulletinPublication === "object") {
    return note.bulletinPublication;
  }
  const evaluationId = asKey(note?.evaluationId);
  const evaluation = evaluationId ? evaluationsById.get(evaluationId) : null;
  return {
    publicationStatus: note?.publicationStatus ?? "published",
    hasEvaluation: Boolean(evaluationId),
    evaluationStatus: evaluation ? evaluation.status : null,
    evaluationActive: evaluation ? evaluation.active !== false : false,
  };
}

function isPublishedBulletinGrade(note, evaluationsById = new Map()) {
  const facts = publicationFacts(note, evaluationsById);
  if (asKey(facts.publicationStatus).toLowerCase() !== "published") return false;
  if (!facts.hasEvaluation) return true;
  if (facts.evaluationActive === false) return false;
  return isPublishedEvaluationStatus(facts.evaluationStatus);
}

/**
 * @param {object} input
 * @param {object} input.student élève dont l'accès a déjà été vérifié
 * @param {object[]} input.schools établissements candidats
 * @param {object[]} input.students élèves candidats (camarades)
 * @param {object[]} input.notes notes candidates
 * @param {object[]} [input.evaluations] évaluations (statut de publication)
 * @param {string} [input.classId] classe de l'élève (source PostgreSQL)
 * @returns {{ school: object, students: object[], notes: object[] }}
 */
function buildStudentBulletinScope({ student, schools, students, notes, evaluations = [], classId } = {}) {
  const school = resolveOwnerSchool(schools, student);
  if (!school || !belongsToSchool(student, school)) {
    throw new StudentBulletinScopeError(
      409,
      "Établissement du bulletin introuvable : bulletin non généré.",
      BULLETIN_SCHOOL_UNRESOLVED,
    );
  }
  const scopedClassId = asKey(classId);
  const studentId = asKey(student.id);
  const classmates = (Array.isArray(students) ? students : []).filter(
    (candidate) =>
      asKey(candidate?.id) &&
      asKey(candidate.id) !== studentId &&
      candidate.archived !== true &&
      belongsToSchool(candidate, school) &&
      sameClass(candidate, student, scopedClassId),
  );
  const cohort = [student, ...classmates];
  const cohortIds = new Set(cohort.map((row) => asKey(row.id)));
  const evaluationsById = new Map(
    (Array.isArray(evaluations) ? evaluations : []).map((row) => [asKey(row?.id), row]),
  );
  const scopedNotes = (Array.isArray(notes) ? notes : []).filter(
    (note) =>
      cohortIds.has(asKey(note?.studentId)) &&
      belongsToSchool(note, school) &&
      isPublishedBulletinGrade(note, evaluationsById),
  );
  return { school, students: cohort, notes: scopedNotes };
}

/** Identité publique de l'établissement exposée dans le bulletin JSON. */
function bulletinSchoolIdentity(school) {
  return { code: asKey(school?.code), name: asKey(school?.name) };
}

module.exports = {
  BULLETIN_SCHOOL_UNRESOLVED,
  StudentBulletinScopeError,
  buildStudentBulletinScope,
  bulletinSchoolIdentity,
  isPublishedBulletinGrade,
  resolveOwnerSchool,
};
