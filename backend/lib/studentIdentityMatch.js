"use strict";

/**
 * Identité élève canonique pour fiche + C18.
 * UUID, matricule, studentCode et alias login/identity convergent
 * sur le même enregistrement, sans élargir le tenant (le scope reste
 * à charge de tenantScopeService.filterRows / membership login_code).
 */

function asKey(value) {
  return String(value ?? "").trim();
}

function collectStudentIdentityKeys(item) {
  if (!item || typeof item !== "object") return [];
  const keys = [
    item.id,
    item.publicId,
    item.matricule,
    item.studentCode,
    item.student_code,
    item.loginCode,
    item.login_code,
    item.identityCode,
    item.identity_code,
    item.studentUuid,
    item.student_uuid,
    item.studentId,
  ];
  const seen = new Set();
  const out = [];
  for (const value of keys) {
    const key = asKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function studentMatchesRef(item, studentRef) {
  const key = asKey(studentRef);
  if (!key) return false;
  return collectStudentIdentityKeys(item).includes(key);
}

function findStudentByIdentity(students, studentRef) {
  const list = Array.isArray(students) ? students : [];
  return list.find((item) => studentMatchesRef(item, studentRef));
}

function studentLinkedToPrincipal(item, studentIds) {
  const linked = new Set((studentIds ?? []).map((value) => asKey(value)).filter(Boolean));
  if (!linked.size) return false;
  return collectStudentIdentityKeys(item).some((key) => linked.has(key));
}

module.exports = {
  collectStudentIdentityKeys,
  studentMatchesRef,
  findStudentByIdentity,
  studentLinkedToPrincipal,
};
