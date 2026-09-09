"use strict";

/**
 * Portée Notes / évaluations pour le rôle Parent (et Élève) :
 * uniquement les élèves canoniquement liés au principal.
 * Fail-closed : studentId hors liaison → 403. Parent = lecture seule.
 */

const PARENT_NOTES_ERROR = Object.freeze({
  FORBIDDEN: "PARENT_CHILD_FORBIDDEN",
  READ_ONLY: "PARENT_NOTES_READ_ONLY",
});

function asRef(value) {
  return String(value ?? "").trim();
}

function normalizeRoleKey(role = "") {
  return asRef(role)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function principalHasRoleKey(principal, roleKey) {
  const wanted = asRef(roleKey).toUpperCase();
  const keys = Array.isArray(principal?.roleKeys) ? principal.roleKeys : [];
  return keys.some((key) => asRef(key).toUpperCase() === wanted);
}

function isParentPrincipalRole(principal = {}) {
  if (principalHasRoleKey(principal, "PARENT")) return true;
  const key = normalizeRoleKey(principal.role);
  return key === "parent" || key.includes("parent");
}

function isStudentPrincipalRole(principal = {}) {
  if (principalHasRoleKey(principal, "STUDENT")) return true;
  const key = normalizeRoleKey(principal.role);
  return key.includes("eleve") || key.includes("etudiant");
}

function isGuardianNotesPrincipal(principal = {}) {
  return isParentPrincipalRole(principal) || isStudentPrincipalRole(principal);
}

function createParentNotesError(status, message, code) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  return error;
}

function studentIdentityKeys(row = {}) {
  return [row.id, row.studentId, row.publicId, row.matricule, row.studentCode, row.student_code]
    .map(asRef)
    .filter(Boolean);
}

function linkedStudentIdSet(principal = {}) {
  const ids = new Set();
  for (const value of principal.studentIds ?? []) {
    const key = asRef(value);
    if (key) ids.add(key);
  }
  const children = Array.isArray(principal.user?.children)
    ? principal.user.children
    : Array.isArray(principal.children)
      ? principal.children
      : [];
  for (const child of children) {
    for (const key of studentIdentityKeys(child)) ids.add(key);
  }
  return ids;
}

function studentMatchesLinkedIds(student, linkedIds) {
  if (!student || !linkedIds?.size) return false;
  return studentIdentityKeys(student).some((key) => linkedIds.has(key));
}

function findStudentByRef(students, studentRef) {
  const key = asRef(studentRef);
  if (!key) return undefined;
  return (students ?? []).find((row) => studentIdentityKeys(row).includes(key));
}

/**
 * Parent / Élève : un studentId d'URL ou de fiche n'est autorisé que s'il
 * appartient à la liaison canonique. Inconnu ou hors liaison → 403 (pas 200 []).
 */
function assertParentNotesStudentAccess(principal, studentRef, students = []) {
  if (!isGuardianNotesPrincipal(principal)) return;
  const requested = asRef(studentRef);
  if (!requested) {
    throw createParentNotesError(
      403,
      "Élève requis pour consulter les notes.",
      PARENT_NOTES_ERROR.FORBIDDEN,
    );
  }
  const linkedIds = linkedStudentIdSet(principal);
  if (!linkedIds.size) {
    throw createParentNotesError(
      403,
      "Aucun élève lié à ce compte.",
      PARENT_NOTES_ERROR.FORBIDDEN,
    );
  }
  if (linkedIds.has(requested)) return;
  const student = findStudentByRef(students, requested);
  if (student && studentMatchesLinkedIds(student, linkedIds)) return;
  throw createParentNotesError(
    403,
    "Accès refusé : cet élève n'est pas lié à votre compte.",
    PARENT_NOTES_ERROR.FORBIDDEN,
  );
}

function assertParentNotesReadOnly(principal) {
  if (!isParentPrincipalRole(principal)) return;
  throw createParentNotesError(
    403,
    "Le compte Parent ne peut pas modifier les notes.",
    PARENT_NOTES_ERROR.READ_ONLY,
  );
}

function filterStudentsForGuardianNotes(students, principal) {
  if (!isGuardianNotesPrincipal(principal)) return students ?? [];
  const linkedIds = linkedStudentIdSet(principal);
  if (!linkedIds.size) return [];
  return (students ?? []).filter((row) => studentMatchesLinkedIds(row, linkedIds));
}

function filterNotesForGuardianStudents(notes, students) {
  const ids = new Set();
  for (const student of students ?? []) {
    for (const key of studentIdentityKeys(student)) ids.add(key);
  }
  if (!ids.size) return [];
  return (notes ?? []).filter((note) => ids.has(asRef(note.studentId)));
}

module.exports = {
  PARENT_NOTES_ERROR,
  isParentPrincipalRole,
  isStudentPrincipalRole,
  isGuardianNotesPrincipal,
  linkedStudentIdSet,
  studentMatchesLinkedIds,
  findStudentByRef,
  assertParentNotesStudentAccess,
  assertParentNotesReadOnly,
  filterStudentsForGuardianNotes,
  filterNotesForGuardianStudents,
};
