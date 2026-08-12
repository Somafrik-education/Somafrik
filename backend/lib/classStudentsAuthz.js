"use strict";

const { BusinessError } = require("../services/authService");
const { classNamesMatch } = require("./dataIntegrityRules");

const SUPER_ADMIN_ROLES = new Set(["Super Administrateur Somafrik", "Super Administrateur OKAFRIK"]);

const SCHOOL_WIDE_STUDENT_READ_ROLES = new Set([
  "Admin School",
  "Admin Pays",
  "Préfet des études",
  "Proviseur",
  "Directeur",
  "Secrétaire",
  "Surveillant",
  "Comptable",
]);

/**
 * @param {string} role
 * @returns {boolean}
 */
function isParentOrStudentRole(role = "") {
  const key = String(role ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return key.includes("parent") || key.includes("eleve") || key.includes("etudiant");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function asRef(value) {
  return String(value ?? "").trim();
}

/**
 * Normalise le contexte classe (string legacy = className).
 * @param {string | { classCode?: string, classId?: string, className?: string } | null | undefined} classContext
 * @returns {{ classCode: string, classId: string, className: string }}
 */
function normalizeClassContext(classContext) {
  if (typeof classContext === "string") {
    return { classCode: "", classId: "", className: asRef(classContext) };
  }
  const ctx = classContext && typeof classContext === "object" ? classContext : {};
  return {
    classCode: asRef(ctx.classCode ?? ctx.class_code),
    classId: asRef(ctx.classId ?? ctx.class_id),
    className: asRef(ctx.className ?? ctx.class_name ?? ctx.name),
  };
}

/**
 * Affectations actives portées par le principal (JWT / session).
 * @param {{ classCodes?: string[], classIds?: string[], classNames?: string[], assignments?: object[] }} principal
 */
function collectTeacherAssignmentRefs(principal = {}) {
  const classCodes = new Set();
  const classIds = new Set();
  const classNames = new Set();

  for (const code of principal.classCodes ?? []) {
    const value = asRef(code);
    if (value) classCodes.add(value);
  }
  for (const id of principal.classIds ?? []) {
    const value = asRef(id);
    if (value) classIds.add(value);
  }
  for (const name of principal.classNames ?? []) {
    const value = asRef(name);
    if (value) classNames.add(value);
  }

  for (const assignment of principal.assignments ?? []) {
    const code = asRef(assignment?.classCode ?? assignment?.class_code);
    const id = asRef(assignment?.classId ?? assignment?.class_id);
    const name = asRef(assignment?.className ?? assignment?.class_name);
    if (code) classCodes.add(code);
    if (id) classIds.add(id);
    if (name) classNames.add(name);
  }

  return { classCodes, classIds, classNames };
}

/**
 * Enseignant : une affectation active doit correspondre à la classe cible.
 * Préfère classCode / classId ; le nom seul ne suffit pas si des codes sont présents.
 *
 * @param {{ role?: string, classCodes?: string[], classIds?: string[], classNames?: string[], assignments?: object[] }} principal
 * @param {string | { classCode?: string, classId?: string, className?: string }} classContext
 * @returns {boolean}
 */
function teacherHasActiveClassAssignment(principal, classContext) {
  if (!principal || principal.role !== "Enseignant") {
    return false;
  }

  const target = normalizeClassContext(classContext);
  const { classCodes, classIds, classNames } = collectTeacherAssignmentRefs(principal);

  // Aucune affectation → refus systématique (y compris classNames: []).
  if (!classCodes.size && !classIds.size && !classNames.size) {
    return false;
  }

  // Identité stable prioritaire dès que le principal porte des codes/IDs.
  if (classCodes.size || classIds.size) {
    if (target.classCode && classCodes.has(target.classCode)) {
      return true;
    }
    if (target.classId && (classIds.has(target.classId) || classCodes.has(target.classId))) {
      return true;
    }
    // Ne pas retomber sur le nom : évite l'accès via homonymes inter-années.
    return false;
  }

  // Legacy : principal uniquement nommé — match par nom.
  if (!target.className) {
    return false;
  }
  return [...classNames].some((name) => classNamesMatch(name, target.className));
}

/**
 * @deprecated Prefer teacherHasActiveClassAssignment with { classCode, className }.
 * @param {{ role?: string, classNames?: string[] }} principal
 * @param {string} className
 * @returns {boolean}
 */
function principalHasClassAccess(principal, className) {
  if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
    return true;
  }
  if (SCHOOL_WIDE_STUDENT_READ_ROLES.has(principal.role)) {
    return true;
  }
  if (principal.role !== "Enseignant") {
    return false;
  }
  return teacherHasActiveClassAssignment(principal, { className });
}

/**
 * Filtre / refuse la liste des élèves d'une classe selon le principal.
 *
 * @param {{ role?: string, classNames?: string[], classCodes?: string[], studentIds?: string[] }} principal
 * @param {string | { classCode?: string, classId?: string, className?: string }} classContext
 * @param {object[]} rows
 * @param {(students: object[], principal: object, studentRef: string) => object | undefined} resolveAuthorizedStudent
 * @returns {object[]}
 */
function scopeClassStudentsForPrincipal(principal, classContext, rows, resolveAuthorizedStudent) {
  if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
    return rows;
  }

  if (SCHOOL_WIDE_STUDENT_READ_ROLES.has(principal.role)) {
    return rows;
  }

  if (principal.role === "Enseignant") {
    if (!teacherHasActiveClassAssignment(principal, classContext)) {
      throw new BusinessError(403, "Accès refusé: classe hors périmètre.");
    }
    return rows;
  }

  if (isParentOrStudentRole(principal.role)) {
    const scoped = (rows ?? []).filter((row) => {
      const ref = row?.id ?? row?.publicId ?? row?.matricule ?? row?.studentCode;
      return Boolean(resolveAuthorizedStudent([row], principal, ref));
    });
    if (!scoped.length) {
      throw new BusinessError(403, "Accès refusé: classe hors périmètre.");
    }
    return scoped;
  }

  return rows;
}

/**
 * Autorise la lecture d'un dossier élève (chemin PG inclus).
 * Enseignant : refuse si aucune affectation active ne correspond (classCode préféré).
 *
 * @param {object | null | undefined} student
 * @param {object} principal
 * @param {string} studentRef
 * @param {(students: object[], principal: object, studentRef: string) => object | undefined} resolveAuthorizedStudent
 * @returns {object | undefined}
 */
function authorizeStudentReadForPrincipal(student, principal, studentRef, resolveAuthorizedStudent) {
  if (!student) {
    return undefined;
  }

  if (principal?.role === "Enseignant") {
    if (
      !teacherHasActiveClassAssignment(principal, {
        classCode: student.classCode,
        classId: student.classId ?? student.class_id,
        className: student.className,
      })
    ) {
      return undefined;
    }
  }

  return resolveAuthorizedStudent([student], principal, studentRef);
}

module.exports = {
  SUPER_ADMIN_ROLES,
  SCHOOL_WIDE_STUDENT_READ_ROLES,
  isParentOrStudentRole,
  normalizeClassContext,
  collectTeacherAssignmentRefs,
  teacherHasActiveClassAssignment,
  principalHasClassAccess,
  scopeClassStudentsForPrincipal,
  authorizeStudentReadForPrincipal,
};
