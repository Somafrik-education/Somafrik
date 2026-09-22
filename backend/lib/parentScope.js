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
const { resolveParentChildren } = require("./parentChildren");

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

function isInactiveParentStudent(row = {}) {
  if (row.archived === true) return true;
  const status = String(row.status ?? "").trim().toLowerCase();
  return ["inactive", "inactif", "archived", "archivé", "archive", "deleted", "supprimé", "supprime"].includes(
    status,
  );
}

function loginSchoolAliases(school = {}, schoolCode = "") {
  const aliases = new Set();
  for (const value of [
    schoolCode,
    school.code,
    school.schoolCode,
    school.legacySchoolCode,
    school.loginCode,
  ]) {
    const code = trim(value).toUpperCase();
    if (code) aliases.add(code);
  }
  return aliases;
}

function studentBelongsToLoginSchool(row = {}, school = {}, schoolCode = "", schoolId = "") {
  const aliases = loginSchoolAliases(school, schoolCode);
  const rowSchoolId = trim(row.schoolId ?? row.school_id);
  if (schoolId && rowSchoolId && rowSchoolId !== schoolId) return false;
  const rowCode = trim(row.schoolCode ?? row.school_code).toUpperCase();
  if (rowCode && aliases.size && !aliases.has(rowCode)) return false;
  if (!rowCode && !rowSchoolId) return false;
  return true;
}

function sortParentChildren(rows = []) {
  return [...rows].sort((left, right) => {
    const name = trim(left.name).localeCompare(trim(right.name), "fr");
    if (name) return name;
    return trim(left.id).localeCompare(trim(right.id));
  });
}

async function loadLiveSchoolStudents(repository, schoolCode, fallbackStudents = []) {
  if (!repository || typeof repository.listSchoolStudents !== "function") {
    return fallbackStudents;
  }
  const code = trim(schoolCode);
  if (!code || code === "*") return fallbackStudents;
  try {
    const live = await repository.listSchoolStudents(code);
    if (Array.isArray(live) && live.length) return live;
  } catch {
    /* projection login : conserver les élèves déjà chargés */
  }
  return fallbackStudents;
}

/**
 * Enfants de session Parent (login Mobile / refresh permissions).
 *
 * PostgreSQL live (`contacts.user_id` → `contact_relations` actives, même
 * school_id) est exclusif : 0 lien ou erreur = 0 enfant. Pas de repli
 * téléphone. La projection mémoire ne sert que si cette lecture est absente.
 */
async function resolveParentLoginChildren({
  repository,
  user = {},
  school = null,
  state = {},
  schoolCode = "",
} = {}) {
  const normalizedSchoolCode = trim(schoolCode || school?.code || user.schoolCode).toUpperCase();
  const schoolId = trim(school?.id || user.schoolId);
  const fallbackStudents = Array.isArray(state.students) ? state.students : [];
  const students = await loadLiveSchoolStudents(repository, normalizedSchoolCode, fallbackStudents);
  const principal = {
    role: "Parent",
    roleKeys: Array.isArray(user.roleKeys) && user.roleKeys.length ? user.roleKeys : ["PARENT"],
    sub: trim(user.id),
    schoolCode: normalizedSchoolCode,
    schoolId,
  };
  const lookup = await lookupCanonicalParentLinkedStudents({
    repository,
    principal,
    schoolStudents: students,
  });

  if (lookup.status === CANONICAL_LOOKUP_ERROR) {
    return [];
  }

  if (lookup.status === CANONICAL_LOOKUP_OK) {
    return sortParentChildren(
      (lookup.students ?? []).filter(
        (row) =>
          !isInactiveParentStudent(row) &&
          studentBelongsToLoginSchool(row, school, normalizedSchoolCode, schoolId),
      ),
    );
  }

  return sortParentChildren(
    resolveParentChildren(
      user,
      { ...state, students },
      normalizedSchoolCode,
    ),
  );
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
  resolveParentLoginChildren,
  classRefsFromStudents,
  scopeSchoolClassesForLinkedStudents,
  CANONICAL_LOOKUP_OK,
  CANONICAL_LOOKUP_UNAVAILABLE,
  CANONICAL_LOOKUP_ERROR,
};
