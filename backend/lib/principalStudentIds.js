"use strict";

/**
 * JWT / principal.studentIds = identité métier élève, jamais users.id.
 * - students.id (linkedStudent.studentId)
 * - student_code / matricule (DTO HTTP encore indexés par code)
 * Sans fiche liée : [] (fail-closed).
 */

function trim(value) {
  return String(value ?? "").trim();
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = trim(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function principalSessionLabel(response) {
  const mobile = response?.role;
  if (mobile === "student") return "Élève / Étudiant";
  if (mobile === "parent_student") return "Parent";
  const userRole = trim(response?.user?.role);
  if (userRole === "Parent" || userRole === "Élève / Étudiant") return userRole;
  return userRole || trim(mobile);
}

function childIdentityKeys(child) {
  return [
    child?.studentUuid,
    child?.studentId,
    child?.id,
    child?.publicId,
    child?.matricule,
    child?.studentCode,
  ];
}

function getPrincipalGuardianStudentIds(response) {
  const user = response?.user ?? {};
  const fromChildren = (user.children ?? []).flatMap(childIdentityKeys);
  const fromRelations = Array.isArray(user.guardianStudentIds) ? user.guardianStudentIds : [];
  const authId = trim(user.id);
  return uniqueNonEmpty([...fromChildren, ...fromRelations]).filter((key) => key !== authId);
}

function getPrincipalStudentIds(response) {
  const user = response?.user ?? {};
  const role = principalSessionLabel(response);
  const authId = trim(user.id);

  if (role === "Parent") {
    return uniqueNonEmpty((user.children ?? []).flatMap(childIdentityKeys)).filter((key) => key !== authId);
  }

  if (role === "Élève / Étudiant") {
    const linked = user.linkedStudent ?? {};
    const studentUuid = trim(linked.studentId ?? linked.student_id);
    if (!studentUuid) return [];
    return uniqueNonEmpty([
      studentUuid,
      linked.studentCode ?? linked.student_code,
      user.matricule,
      user.studentCode,
    ]).filter((key) => key !== authId);
  }

  return [];
}

module.exports = {
  getPrincipalStudentIds,
  getPrincipalGuardianStudentIds,
  principalSessionLabel,
};
