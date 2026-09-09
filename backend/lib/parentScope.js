"use strict";

/**
 * Périmètre Parent / Élève — fail-closed.
 * Reconnaissance par libellé `role` ET par `roleKeys` (PARENT / STUDENT).
 * Les clés d'identité élève sont fusionnées (uuid, student_code, matricule).
 */

const { principalHasRole } = require("./userRoleLifecycle");

function trim(value) {
  return String(value ?? "").trim();
}

function uniqueKeys(values) {
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

function principalIsParent(principal) {
  if (!principal) return false;
  if (principalHasRole(principal, "Parent")) return true;
  const keys = (principal.roleKeys ?? []).map((value) => String(value ?? "").trim().toUpperCase());
  return keys.includes("PARENT");
}

function principalIsStudent(principal) {
  if (!principal) return false;
  if (principalHasRole(principal, "Élève / Étudiant")) return true;
  const keys = (principal.roleKeys ?? []).map((value) => String(value ?? "").trim().toUpperCase());
  return keys.includes("STUDENT");
}

function principalIsParentOrStudent(principal) {
  return principalIsParent(principal) || principalIsStudent(principal);
}

function expandStudentIdentityKeys(student = {}) {
  return uniqueKeys([
    student.studentUuid,
    student.student_uuid,
    student.studentId,
    student.student_id,
    student.id,
    student.publicId,
    student.matricule,
    student.studentCode,
    student.student_code,
    student.loginCode,
    student.identityCode,
  ]);
}

function collectLinkedStudentKeys(principal = {}) {
  const fromPrincipal = [
    ...(principal.studentIds ?? []),
    ...(principal.linkedStudentIds ?? []),
    ...(principal.guardianStudentIds ?? []),
  ];
  const fromChildren = (principal.children ?? []).flatMap((child) => expandStudentIdentityKeys(child));
  return uniqueKeys([...fromPrincipal, ...fromChildren]);
}

function studentMatchesLinkedKeys(student, linkedKeys) {
  const allowed = linkedKeys instanceof Set ? linkedKeys : new Set(linkedKeys ?? []);
  if (!allowed.size) return false;
  return expandStudentIdentityKeys(student).some((key) => allowed.has(key));
}

function linkedStudentsFromRows(students, principal) {
  const keys = new Set(collectLinkedStudentKeys(principal));
  if (!keys.size) return [];
  return (students ?? []).filter((row) => studentMatchesLinkedKeys(row, keys));
}

function mergeLinkedStudentKeys(principal, students = []) {
  const seed = collectLinkedStudentKeys(principal);
  const linked = linkedStudentsFromRows(students, { ...principal, studentIds: seed });
  return uniqueKeys([...seed, ...linked.flatMap((row) => expandStudentIdentityKeys(row))]);
}

/**
 * Quand des enfants canoniques existent (contact_relations), le JWT ne peut
 * qu'ajouter des alias d'identité de ces enfants — jamais un camarade.
 */
function restrictStudentIdsToCanonicalChildren(studentIds, canonicalChildren = []) {
  const canonicalKeys = uniqueKeys((canonicalChildren ?? []).flatMap((row) => expandStudentIdentityKeys(row)));
  if (!canonicalKeys.length) {
    return uniqueKeys(studentIds ?? []);
  }
  const allowed = new Set(canonicalKeys);
  const jwtWithin = (studentIds ?? []).filter((value) => allowed.has(trim(value)));
  return uniqueKeys([...canonicalKeys, ...jwtWithin]);
}

function classRefsFromStudents(students = []) {
  const classCodes = [];
  const classIds = [];
  for (const row of students ?? []) {
    const code = trim(row.classCode ?? row.class_code);
    const id = trim(row.classId ?? row.class_id);
    if (code) classCodes.push(code);
    if (id) classIds.push(id);
  }
  return { classCodes: uniqueKeys(classCodes), classIds: uniqueKeys(classIds) };
}

function scopeSchoolClassesForLinkedStudents(rows, linkedStudents) {
  const { classCodes, classIds } = classRefsFromStudents(linkedStudents);
  const codeSet = new Set(classCodes);
  const idSet = new Set(classIds);
  if (!codeSet.size && !idSet.size) {
    return [];
  }
  const counts = new Map();
  for (const student of linkedStudents) {
    const code = trim(student.classCode ?? student.class_code);
    const id = trim(student.classId ?? student.class_id);
    const key = code || id;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return (rows ?? [])
    .filter((row) => {
      const code = trim(row.classCode ?? row.class_code ?? row.publicId);
      const id = trim(row.classId ?? row.class_id ?? row.id);
      return (code && codeSet.has(code)) || (id && idSet.has(id));
    })
    .map((row) => {
      const code = trim(row.classCode ?? row.class_code ?? row.publicId);
      const id = trim(row.classId ?? row.class_id ?? row.id);
      const own = counts.get(code) ?? counts.get(id) ?? 0;
      return { ...row, students: own, studentCount: own };
    });
}

module.exports = {
  principalIsParent,
  principalIsStudent,
  principalIsParentOrStudent,
  expandStudentIdentityKeys,
  collectLinkedStudentKeys,
  studentMatchesLinkedKeys,
  linkedStudentsFromRows,
  mergeLinkedStudentKeys,
  restrictStudentIdsToCanonicalChildren,
  classRefsFromStudents,
  scopeSchoolClassesForLinkedStudents,
};
