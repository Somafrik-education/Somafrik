"use strict";

/**
 * Autorisation d'écriture Présences — identité de classe uniquement
 * (classId UUID / classCode). className n'est jamais une clé métier.
 */

function asRef(value) {
  return String(value ?? "").trim();
}

/**
 * @param {object} payload
 * @returns {{ classId: string, classCode: string }}
 */
function requestedClassIdentity(payload = {}) {
  return {
    classId: asRef(payload.classId ?? payload.class_id),
    classCode: asRef(payload.classCode ?? payload.class_code),
  };
}

/**
 * Fusionne l'identité de classe du lot et de l'item. className est ignoré.
 * @param {object} item
 * @param {object} batch
 */
function mergeAttendanceClassIdentity(item = {}, batch = {}) {
  const fromItem = requestedClassIdentity(item);
  const fromBatch = requestedClassIdentity(batch);
  return {
    classId: fromItem.classId || fromBatch.classId,
    classCode: fromItem.classCode || fromBatch.classCode,
  };
}

/**
 * Enseignant pédagogique explicite (admin/préfet). Jamais authorId :
 * c'est l'acteur JWT, pas l'enseignant du cours.
 */
function explicitAttendanceTeacherKey(payload = {}) {
  return asRef(payload.teacherId ?? payload.teacher_code ?? payload.teacherCode);
}

function mergeAttendanceTeacherKey(item = {}, batch = {}) {
  const key = explicitAttendanceTeacherKey(item) || explicitAttendanceTeacherKey(batch);
  return key ? { teacherId: key } : {};
}

/**
 * Inscription active dans la classe demandée (UUID prioritaire, sinon classCode).
 * @param {{ classId?: string, classCode?: string, status?: string }} enrollment
 * @param {{ classId?: string, classCode?: string }} requested
 */
function activeEnrollmentMatchesRequestedClass(enrollment, requested = {}) {
  if (!enrollment) return false;
  const status = asRef(enrollment.status ?? enrollment.enrollmentStatus).toLowerCase();
  if (status && status !== "active" && status !== "actif") {
    return false;
  }
  const enrollmentClassId = asRef(enrollment.classId ?? enrollment.class_id);
  const enrollmentClassCode = asRef(enrollment.classCode ?? enrollment.class_code);
  const requestedClassId = asRef(requested.classId ?? requested.class_id);
  const requestedClassCode = asRef(requested.classCode ?? requested.class_code);

  if (!requestedClassId && !requestedClassCode) {
    return Boolean(enrollmentClassId || enrollmentClassCode);
  }
  if (requestedClassId && enrollmentClassId && requestedClassId === enrollmentClassId) {
    return true;
  }
  if (requestedClassCode && enrollmentClassCode && requestedClassCode === enrollmentClassCode) {
    return true;
  }
  return false;
}

/**
 * Si classId et classCode sont tous deux fournis, ils doivent désigner la même classe.
 * @param {{ id?: string, class_code?: string }} classRow
 * @param {{ classId?: string, classCode?: string }} requested
 */
function classRowMatchesRequestedIdentity(classRow, requested = {}) {
  if (!classRow) return false;
  const rowId = asRef(classRow.id ?? classRow.classId ?? classRow.class_id);
  const rowCode = asRef(classRow.class_code ?? classRow.classCode);
  const requestedClassId = asRef(requested.classId);
  const requestedClassCode = asRef(requested.classCode);
  if (requestedClassId && rowId && requestedClassId !== rowId) {
    return false;
  }
  if (requestedClassCode && rowCode && requestedClassCode !== rowCode) {
    return false;
  }
  return Boolean((requestedClassId && rowId) || (requestedClassCode && rowCode) || rowId);
}

module.exports = {
  asRef,
  requestedClassIdentity,
  mergeAttendanceClassIdentity,
  explicitAttendanceTeacherKey,
  mergeAttendanceTeacherKey,
  activeEnrollmentMatchesRequestedClass,
  classRowMatchesRequestedIdentity,
};
