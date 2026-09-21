"use strict";

/**
 * Périmètre Parent / Élève — fail-closed.
 *
 * Pour un Parent PostgreSQL, l'autorité de rattachement est exclusivement :
 * contacts.user_id -> contact_relations.student_id (status active).
 * Les studentIds du JWT ne peuvent jamais élargir ce périmètre.
 */

const { principalHasRole } = require("./userRoleLifecycle");
const { collectStudentIdentityKeys } = require("./studentIdentityMatch");

function trim(value) {
  return String(value ?? "").trim();
}

function uniqueKeys(values) {
  const seen = new Set();
  const out = [];
  for (const value of values ?? []) {
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
  return (principal.roleKeys ?? []).some(
    (value) => String(value ?? "").trim().toUpperCase() === "PARENT",
  );
}

function principalIsStudent(principal) {
  if (!principal) return false;
  if (principalHasRole(principal, "Élève / Étudiant")) return true;
  return (principal.roleKeys ?? []).some(
    (value) => String(value ?? "").trim().toUpperCase() === "STUDENT",
  );
}

function principalIsParentOrStudent(principal) {
  return principalIsParent(principal) || principalIsStudent(principal);
}

function expandStudentIdentityKeys(student = {}) {
  return uniqueKeys(collectStudentIdentityKeys(student));
}

function collectLinkedStudentKeys(principal = {}) {
  const children = [
    ...(Array.isArray(principal.children) ? principal.children : []),
    ...(Array.isArray(principal.user?.children) ? principal.user.children : []),
  ];
  return uniqueKeys([
    ...(principal.studentIds ?? []),
    ...(principal.linkedStudentIds ?? []),
    ...(principal.guardianStudentIds ?? []),
    ...children.flatMap((child) => expandStudentIdentityKeys(child)),
  ]);
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

const CANONICAL_LOOKUP_OK = "ok";
const CANONICAL_LOOKUP_UNAVAILABLE = "unavailable";
const CANONICAL_LOOKUP_ERROR = "error";

function emptyParentLinkedHydration() {
  return { studentIds: [], linked: [], classCodes: [], classIds: [] };
}

function restrictStudentIdsToCanonicalChildren(jwtStudentIds, canonicalChildren = []) {
  const canonicalKeys = uniqueKeys(
    (canonicalChildren ?? []).flatMap((row) => expandStudentIdentityKeys(row)),
  );
  if (!canonicalKeys.length) return [];
  const allowed = new Set(canonicalKeys);
  const jwtWithin = (jwtStudentIds ?? [])
    .map(trim)
    .filter((value) => value && allowed.has(value));
  return uniqueKeys([...canonicalKeys, ...jwtWithin]);
}

async function lookupCanonicalParentLinkedStudents({
  repository,
  principal,
  schoolStudents,
} = {}) {
  if (!repository || typeof repository.listLiveParentLinkedStudentIdsForSync !== "function") {
    return { status: CANONICAL_LOOKUP_UNAVAILABLE, students: [] };
  }
  if (!principalIsParent(principal)) {
    return { status: CANONICAL_LOOKUP_UNAVAILABLE, students: [] };
  }

  const userId = trim(principal?.sub);
  if (!userId) {
    return { status: CANONICAL_LOOKUP_ERROR, students: [] };
  }

  let schoolId = trim(principal?.effectiveSchoolId ?? principal?.schoolId);
  if (!schoolId && typeof repository.getSchoolByCode === "function") {
    try {
      const school = await repository.getSchoolByCode(trim(principal?.schoolCode));
      schoolId = trim(school?.id ?? school?.school_id);
    } catch (error) {
      return { status: CANONICAL_LOOKUP_ERROR, students: [], error };
    }
  }
  if (!schoolId) {
    return { status: CANONICAL_LOOKUP_ERROR, students: [] };
  }

  try {
    const rows = await repository.listLiveParentLinkedStudentIdsForSync(userId, schoolId);
    const canonicalIds = new Set(
      (rows ?? [])
        .map((row) => trim(row?.studentId ?? row?.student_id ?? row?.id))
        .filter(Boolean),
    );
    const students = canonicalIds.size
      ? (schoolStudents ?? []).filter((student) =>
          expandStudentIdentityKeys(student).some((key) => canonicalIds.has(key)),
        )
      : [];
    return { status: CANONICAL_LOOKUP_OK, students };
  } catch (error) {
    return { status: CANONICAL_LOOKUP_ERROR, students: [], error };
  }
}

/**
 * Canonical OK + 0 lien => 0 enfant.
 * Canonical error => 0 enfant.
 * Unavailable => fallback fixture/mémoire seulement.
 */
function resolveParentLinkedHydration(lookup, options = {}) {
  const jwtStudentIds = options.jwtStudentIds ?? [];
  const schoolStudents = options.schoolStudents ?? [];
  const fallbackChildren = options.fallbackChildren ?? [];

  if (!lookup || lookup.status === CANONICAL_LOOKUP_ERROR) {
    return emptyParentLinkedHydration();
  }

  if (lookup.status === CANONICAL_LOOKUP_OK) {
    const studentIds = restrictStudentIdsToCanonicalChildren(
      jwtStudentIds,
      lookup.students ?? [],
    );
    const linked = (lookup.students ?? []).filter((row) =>
      studentMatchesLinkedKeys(row, new Set(studentIds)),
    );
    const refs = classRefsFromStudents(linked);
    return { studentIds, linked, classCodes: refs.classCodes, classIds: refs.classIds };
  }

  const seed = uniqueKeys([
    ...jwtStudentIds,
    ...fallbackChildren.flatMap((child) => expandStudentIdentityKeys(child)),
  ]);
  const pool = schoolStudents.length ? schoolStudents : fallbackChildren;
  const linked = (pool ?? []).filter((student) =>
    studentMatchesLinkedKeys(student, new Set(seed)),
  );
  const studentIds = uniqueKeys([
    ...seed,
    ...linked.flatMap((row) => expandStudentIdentityKeys(row)),
  ]);
  const refs = classRefsFromStudents(linked);
  return { studentIds, linked, classCodes: refs.classCodes, classIds: refs.classIds };
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
  return {
    classCodes: uniqueKeys(classCodes),
    classIds: uniqueKeys(classIds),
  };
}

function scopeSchoolClassesForLinkedStudents(rows, linkedStudents) {
  const { classCodes, classIds } = classRefsFromStudents(linkedStudents);
  const codeSet = new Set(classCodes);
  const idSet = new Set(classIds);
  if (!codeSet.size && !idSet.size) return [];

  const counts = new Map();
  for (const student of linkedStudents ?? []) {
    const code = trim(student.classCode ?? student.class_code);
    const id = trim(student.classId ?? student.class_id);
    if (code) counts.set(`code:${code}`, (counts.get(`code:${code}`) ?? 0) + 1);
    if (id) counts.set(`id:${id}`, (counts.get(`id:${id}`) ?? 0) + 1);
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
      const own = (code && counts.get(`code:${code}`)) || (id && counts.get(`id:${id}`)) || 0;
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
  restrictStudentIdsToCanonicalChildren,
  lookupCanonicalParentLinkedStudents,
  resolveParentLinkedHydration,
  classRefsFromStudents,
  scopeSchoolClassesForLinkedStudents,
  CANONICAL_LOOKUP_OK,
  CANONICAL_LOOKUP_UNAVAILABLE,
  CANONICAL_LOOKUP_ERROR,
};
