"use strict";

/**
 * Enrichissement session enseignant pour login / refresh / change-password.
 * Fail-closed sur le statut enregistré (pas de défaut "active").
 */
const {
  isExplicitlyActiveAssignmentStatus,
  filterActiveTeacherAssignments,
} = require("./classStudentsAuthz");

/**
 * Statut tel qu'enregistré — sans fallback.
 * @param {object} item
 * @returns {unknown}
 */
function resolveRecordedAssignmentStatus(item = {}) {
  if (Object.hasOwn(item, "status")) {
    return item.status;
  }
  if (Object.hasOwn(item, "assignmentStatus")) {
    return item.assignmentStatus;
  }
  if (Object.hasOwn(item, "assignment_status")) {
    return item.assignment_status;
  }
  return undefined;
}

/**
 * Garde le statut enregistré et ne conserve que les affectations explicitement actives.
 * @param {object[]} assignments
 * @returns {object[]}
 */
function selectActiveTeacherAssignments(assignments = []) {
  return (Array.isArray(assignments) ? assignments : [])
    .map((item) => ({
      ...item,
      status: resolveRecordedAssignmentStatus(item),
    }))
    .filter((item) => isExplicitlyActiveAssignmentStatus(item.status));
}

/**
 * @param {object} user
 * @param {object} state
 * @returns {object[]}
 */
function listLinkedTeachers(user, state) {
  const userId = String(user?.id ?? user?.sub ?? "").trim();
  const identifier = String(user?.identifier ?? "").trim().toLowerCase();
  return (state?.teachers ?? []).filter((row) => {
    const ids = [row.userId, row.id, row.publicId, row.contactId].map((value) =>
      String(value ?? "").trim(),
    );
    if (userId && ids.includes(userId)) return true;
    return identifier && String(row.identifier ?? "").trim().toLowerCase() === identifier;
  });
}

/**
 * Choisit l'enseignant lié qui a au moins une affectation explicitement active.
 * @param {object} user
 * @param {object} state
 * @returns {{ teacher: object, assignments: object[] } | null}
 */
function resolveLinkedTeacherWithActiveAssignments(user, state) {
  const { resolveTeacherAssignments } = require("../services/authService");
  const linkedTeachers = listLinkedTeachers(user, state);
  for (const teacher of linkedTeachers) {
    const raw = resolveTeacherAssignments(teacher, user, state.assignments ?? []);
    const active = selectActiveTeacherAssignments(raw);
    if (active.length) {
      return { teacher, assignments: active };
    }
  }
  return null;
}

/**
 * Enrichit l'utilisateur enseignant avec affectations actives + identifiants stables.
 * @param {object} user
 * @param {object} state
 * @returns {object}
 */
function enrichTeacherUserWithActiveAssignments(user, state) {
  if (!user || user.role !== "Enseignant") {
    return user;
  }
  const matched = resolveLinkedTeacherWithActiveAssignments(user, state);
  const assignments = matched?.assignments ?? [];
  return {
    ...user,
    assignments,
    assignedClasses: [...new Set(assignments.map((item) => item.className).filter(Boolean))],
    assignedClassCodes: [
      ...new Set(assignments.map((item) => item.classCode ?? item.class_code).filter(Boolean)),
    ],
    assignedClassIds: [
      ...new Set(assignments.map((item) => item.classId ?? item.class_id).filter(Boolean)),
    ],
    courses: [...new Set(assignments.map((item) => item.course).filter(Boolean))],
  };
}

/**
 * Champs principal à embarquer dans l'access token après refresh.
 * @param {object} user
 * @param {object} state
 * @returns {{ assignments: object[], classNames: string[], classCodes: string[], classIds: string[] }}
 */
function teacherPrincipalAssignmentFields(user, state) {
  const enriched = enrichTeacherUserWithActiveAssignments(
    { ...user, role: "Enseignant" },
    state,
  );
  const active = filterActiveTeacherAssignments(enriched.assignments ?? []);
  return {
    assignments: active,
    classNames: [...new Set(active.map((item) => item.className).filter(Boolean))],
    classCodes: [
      ...new Set(active.map((item) => item.classCode ?? item.class_code).filter(Boolean)),
    ],
    classIds: [
      ...new Set(active.map((item) => item.classId ?? item.class_id).filter(Boolean)),
    ],
  };
}

module.exports = {
  resolveRecordedAssignmentStatus,
  selectActiveTeacherAssignments,
  listLinkedTeachers,
  resolveLinkedTeacherWithActiveAssignments,
  enrichTeacherUserWithActiveAssignments,
  teacherPrincipalAssignmentFields,
};
