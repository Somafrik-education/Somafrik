"use strict";

const { BusinessError } = require("../services/authService");
const { principalHasRole, principalHasAnyRole } = require("./userRoleLifecycle");

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

/** Statuts d'affectation explicitement actifs (tout le reste = fail-closed). */
const ACTIVE_ASSIGNMENT_STATUSES = new Set(["active", "actif", "open", "ouverte"]);

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
 * Fail-closed : seul un statut explicitement actif autorise.
 * Absent, vide, inconnu ou inactif → false.
 * @param {unknown} status
 * @returns {boolean}
 */
function isExplicitlyActiveAssignmentStatus(status) {
  const normalized = String(status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  return ACTIVE_ASSIGNMENT_STATUSES.has(normalized);
}

/**
 * @param {object} assignment
 * @returns {boolean}
 */
function isActiveTeacherAssignment(assignment) {
  if (!assignment || typeof assignment !== "object") {
    return false;
  }
  return isExplicitlyActiveAssignmentStatus(
    assignment.status ?? assignment.assignmentStatus ?? assignment.assignment_status,
  );
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
 * Ne conserve que les affectations explicitement actives.
 * Les agrégats top-level (classCodes / classIds / classNames) ne sont pas utilisés
 * pour l'autorisation : une entrée inactive dans assignments ne doit pas fuir via classCodes.
 *
 * @param {{ assignments?: object[] }} principal
 * @returns {{ classCodes: Set<string>, classIds: Set<string>, activeAssignments: object[] }}
 */
function collectTeacherAssignmentRefs(principal = {}) {
  const classCodes = new Set();
  const classIds = new Set();
  const activeAssignments = [];

  for (const assignment of principal.assignments ?? []) {
    if (!isActiveTeacherAssignment(assignment)) {
      continue;
    }
    activeAssignments.push(assignment);
    const code = asRef(assignment?.classCode ?? assignment?.class_code);
    const id = asRef(assignment?.classId ?? assignment?.class_id);
    if (code) classCodes.add(code);
    if (id) classIds.add(id);
  }

  return { classCodes, classIds, activeAssignments };
}

/**
 * Filtre les affectations pour le principal JWT (buildPrincipal / login).
 * @param {object[]} assignments
 * @returns {object[]}
 */
function filterActiveTeacherAssignments(assignments = []) {
  return (Array.isArray(assignments) ? assignments : []).filter(isActiveTeacherAssignment);
}

/**
 * Enseignant (routes élèves PG) : exige une affectation active avec identité stable
 * (classCode ou classId). Jamais d'autorisation par className seul.
 *
 * @param {{ role?: string, assignments?: object[] }} principal
 * @param {string | { classCode?: string, classId?: string, className?: string }} classContext
 * @returns {boolean}
 */
function teacherHasActiveClassAssignment(principal, classContext) {
  if (!principal || !principalHasRole(principal, "Enseignant")) {
    return false;
  }

  const target = normalizeClassContext(classContext);
  if (!target.classCode && !target.classId) {
    // Pas d'identité stable côté ressource → refus (pas de fallback nom).
    return false;
  }

  const { classCodes, classIds } = collectTeacherAssignmentRefs(principal);
  if (!classCodes.size && !classIds.size) {
    return false;
  }

  if (target.classCode && classCodes.has(target.classCode)) {
    return true;
  }
  if (target.classId && (classIds.has(target.classId) || classCodes.has(target.classId))) {
    return true;
  }
  return false;
}

/**
 * @param {{ role?: string, assignments?: object[] }} principal
 * @param {string} className
 * @returns {boolean}
 */
function principalHasClassAccess(principal, className) {
  if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
    return true;
  }
  if (principalHasAnyRole(principal, SCHOOL_WIDE_STUDENT_READ_ROLES)) {
    return true;
  }
  if (!principalHasRole(principal, "Enseignant")) {
    return false;
  }
  // Routes élèves : le nom seul ne suffit plus.
  return teacherHasActiveClassAssignment(principal, { className });
}

/**
 * Filtre / refuse la liste des élèves d'une classe selon le principal.
 *
 * @param {{ role?: string, assignments?: object[], studentIds?: string[] }} principal
 * @param {string | { classCode?: string, classId?: string, className?: string }} classContext
 * @param {object[]} rows
 * @param {(students: object[], principal: object, studentRef: string) => object | undefined} resolveAuthorizedStudent
 * @returns {object[]}
 */
function scopeClassStudentsForPrincipal(principal, classContext, rows, resolveAuthorizedStudent) {
  if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
    return rows;
  }

  if (principalHasAnyRole(principal, SCHOOL_WIDE_STUDENT_READ_ROLES)) {
    return rows;
  }

  if (principalHasRole(principal, "Enseignant")) {
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
 * Filtre la liste établissement (annuaire) selon le principal.
 * Enseignant : uniquement les élèves dont la classe active est dans ses affectations.
 *
 * @param {{ role?: string, assignments?: object[], studentIds?: string[] }} principal
 * @param {object[]} rows
 * @param {(students: object[], principal: object, studentRef: string) => object | undefined} resolveAuthorizedStudent
 * @returns {object[]}
 */
function scopeSchoolStudentsForPrincipal(principal, rows, resolveAuthorizedStudent) {
  if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
    return rows;
  }

  if (principalHasAnyRole(principal, SCHOOL_WIDE_STUDENT_READ_ROLES)) {
    return rows;
  }

  if (principalHasRole(principal, "Enseignant")) {
    const { classCodes, classIds } = collectTeacherAssignmentRefs(principal);
    if (!classCodes.size && !classIds.size) {
      throw new BusinessError(403, "Accès refusé: aucune classe affectée.");
    }
    return (rows ?? []).filter((row) => {
      const code = asRef(row?.classCode ?? row?.class_code);
      const id = asRef(row?.classId ?? row?.class_id);
      return (code && classCodes.has(code)) || (id && (classIds.has(id) || classCodes.has(id)));
    });
  }

  if (isParentOrStudentRole(principal.role)) {
    const linkedIds = new Set(
      (principal.studentIds ?? principal.linkedStudentIds ?? []).map((value) => asRef(value)).filter(Boolean),
    );
    return (rows ?? []).filter((row) => {
      const candidates = [row?.id, row?.publicId, row?.matricule, row?.studentCode].map(asRef);
      return candidates.some((value) => value && linkedIds.has(value));
    });
  }

  return rows;
}

/**
 * Autorise la lecture d'un dossier élève (chemin PG inclus).
 * Enseignant : affectation active + classCode/classId uniquement.
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
  ACTIVE_ASSIGNMENT_STATUSES,
  isParentOrStudentRole,
  isExplicitlyActiveAssignmentStatus,
  isActiveTeacherAssignment,
  normalizeClassContext,
  collectTeacherAssignmentRefs,
  filterActiveTeacherAssignments,
  teacherHasActiveClassAssignment,
  principalHasClassAccess,
  scopeClassStudentsForPrincipal,
  scopeSchoolStudentsForPrincipal,
  authorizeStudentReadForPrincipal,
};
