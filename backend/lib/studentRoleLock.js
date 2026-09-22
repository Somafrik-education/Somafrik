"use strict";

/**
 * P0 — rôles d'un compte lié canoniquement à une fiche élève.
 *
 * Preuve : students.user_id = users.id (fiche active).
 * Jamais student_code, login_code, identifier, nom, ni la présence du rôle STUDENT.
 */

const {
  USER_ROLE_ERROR,
  createUserRoleError,
  toRoleKey,
} = require("./userRoleLifecycle");
const {
  isActiveStudentStatus,
  studentCanonicalUserId,
} = require("./businessProfileIntegrity");

const STUDENT_KEY = "STUDENT";

const STUDENT_ROLE_LOCKED_MESSAGE =
  "Les rôles d'un compte lié à un élève ne peuvent pas être modifiés.";

const SELECT_CANONICAL_LINKED_STUDENT_SQL = `
  SELECT st.id, st.student_code, st.status, st.school_id,
         NULLIF(to_jsonb(st)->>'user_id', '') AS user_id
  FROM students st
  WHERE NULLIF(to_jsonb(st)->>'user_id', '') = $1::text
    AND COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
  ORDER BY st.id::text
  LIMIT 1
`;

function compareStudentId(left, right) {
  return String(left?.id ?? left?.student_id ?? "").localeCompare(String(right?.id ?? right?.student_id ?? ""));
}

function findCanonicalLinkedStudent(students = [], userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  const hits = (students ?? []).filter((student) => {
    if (studentCanonicalUserId(student) !== uid) return false;
    return isActiveStudentStatus(student.status);
  });
  if (!hits.length) return null;
  hits.sort(compareStudentId);
  return hits[0];
}

function createStudentRoleLockedError(details) {
  return createUserRoleError(409, STUDENT_ROLE_LOCKED_MESSAGE, USER_ROLE_ERROR.STUDENT_ROLE_LOCKED, details);
}

function isStudentRoleLockedError(error) {
  if (!error) return false;
  if (error.code === USER_ROLE_ERROR.STUDENT_ROLE_LOCKED) return true;
  return String(error.message ?? "").includes("STUDENT_ROLE_LOCKED");
}

function assertStudentRoleMutation({ linkedStudent, operation, roleKey, payload } = {}) {
  if (!linkedStudent) return;
  const details = {
    studentId: String(linkedStudent.id ?? linkedStudent.student_id ?? linkedStudent.studentId ?? "").trim(),
    studentCode: String(linkedStudent.student_code ?? linkedStudent.studentCode ?? "").trim(),
    operation: operation || null,
  };
  if (payload && typeof payload === "object" && Array.isArray(payload.roles)) {
    throw createStudentRoleLockedError(details);
  }
  const key = toRoleKey(roleKey ?? payload?.role ?? payload?.roleKey ?? payload?.role_key);
  if (operation === "grant" && key === STUDENT_KEY) return;
  throw createStudentRoleLockedError(details);
}

async function loadCanonicalLinkedStudent(tx, userId) {
  const uid = String(userId ?? "").trim();
  if (!uid) return null;
  if (typeof tx.getCanonicalLinkedStudentByUserId === "function") {
    try {
      return (await tx.getCanonicalLinkedStudentByUserId(uid)) ?? null;
    } catch (error) {
      const { isOptionalProfileLookupError } = require("./businessProfileIntegrity");
      if (isOptionalProfileLookupError(error)) return null;
      throw error;
    }
  }
  return null;
}

async function assertCanonicalStudentRolesLocked(tx, userId, mutation) {
  const linkedStudent = await loadCanonicalLinkedStudent(tx, userId);
  assertStudentRoleMutation({ linkedStudent, ...mutation });
  return linkedStudent;
}

module.exports = {
  STUDENT_KEY,
  STUDENT_ROLE_LOCKED_MESSAGE,
  SELECT_CANONICAL_LINKED_STUDENT_SQL,
  findCanonicalLinkedStudent,
  createStudentRoleLockedError,
  isStudentRoleLockedError,
  assertStudentRoleMutation,
  loadCanonicalLinkedStudent,
  assertCanonicalStudentRolesLocked,
};
