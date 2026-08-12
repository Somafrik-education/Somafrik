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
  const target = String(className ?? "").trim();
  if (!target) {
    return false;
  }
  return (principal.classNames ?? []).some((name) => classNamesMatch(name, target));
}

/**
 * Filtre / refuse la liste des élèves d'une classe selon le principal.
 * Enseignant : uniquement ses classes affectées.
 * Parent / élève : uniquement les dossiers liés (pas le roster complet).
 *
 * @param {{ role?: string, classNames?: string[], studentIds?: string[] }} principal
 * @param {string} className
 * @param {object[]} rows
 * @param {(students: object[], principal: object, studentRef: string) => object | undefined} resolveAuthorizedStudent
 * @returns {object[]}
 */
function scopeClassStudentsForPrincipal(principal, className, rows, resolveAuthorizedStudent) {
  if (!principal || SUPER_ADMIN_ROLES.has(principal.role)) {
    return rows;
  }

  if (SCHOOL_WIDE_STUDENT_READ_ROLES.has(principal.role)) {
    return rows;
  }

  if (principal.role === "Enseignant") {
    if (!principalHasClassAccess(principal, className)) {
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
  return resolveAuthorizedStudent([student], principal, studentRef);
}

module.exports = {
  SUPER_ADMIN_ROLES,
  SCHOOL_WIDE_STUDENT_READ_ROLES,
  isParentOrStudentRole,
  principalHasClassAccess,
  scopeClassStudentsForPrincipal,
  authorizeStudentReadForPrincipal,
};
