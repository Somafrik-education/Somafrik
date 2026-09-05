"use strict";

/**
 * Exclusivité des profils métier élève / enseignant dans un même établissement.
 *
 * Compte utilisateur (users) ≠ profil métier (students | teachers).
 * Un simple GRANT/REVOKE de rôle d'accès ne doit jamais fabriquer les deux.
 */

const STUDENT_TO_TEACHER_MESSAGE =
  "Ce compte est lié à un élève actif. Le rôle Enseignant ne peut pas lui être attribué. Fermez d'abord le profil élève via un workflow de conversion explicite.";

const TEACHER_TO_STUDENT_MESSAGE =
  "Ce compte est lié à un enseignant actif. Il ne peut pas être inscrit comme élève. Fermez d'abord le profil enseignant via un workflow de conversion explicite.";

const BUSINESS_PROFILE_CONFLICT = "BUSINESS_PROFILE_CONFLICT";

const INACTIVE_STUDENT_STATUSES = new Set([
  "inactive",
  "deleted",
  "archived",
  "closed",
  "transferred",
]);

const INACTIVE_TEACHER_STATUSES = new Set(["inactive", "deleted", "archived"]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeStatus(value) {
  return asTrimmed(value).toLowerCase() || "active";
}

function isActiveStudentStatus(status) {
  return !INACTIVE_STUDENT_STATUSES.has(normalizeStatus(status));
}

function isActiveTeacherStatus(status) {
  return !INACTIVE_TEACHER_STATUSES.has(normalizeStatus(status));
}

function studentCodeOf(row = {}) {
  return asTrimmed(row.student_code ?? row.studentCode ?? row.identity_code ?? row.identityCode);
}

function studentIdentityKeys(student = {}) {
  return [
    asTrimmed(student.student_code ?? student.studentCode),
    asTrimmed(student.identity_code ?? student.identityCode),
    asTrimmed(student.login_code ?? student.loginCode),
  ].filter(Boolean);
}

function userIdentityKeys(user = {}) {
  return [
    asTrimmed(user.user_code ?? user.userCode),
    asTrimmed(user.identity_code ?? user.identityCode),
    asTrimmed(user.login_code ?? user.loginCode),
  ].filter(Boolean);
}

function userMatchesStudentCode(user, studentCode) {
  const wanted = asTrimmed(studentCode);
  if (!wanted) return false;
  return userIdentityKeys(user).includes(wanted);
}

function userMatchesStudent(user, student) {
  const uid = asTrimmed(user?.id ?? user?.userId);
  const studentUserId = asTrimmed(student?.user_id ?? student?.userId);
  if (uid && studentUserId && uid === studentUserId) return true;
  const userKeys = new Set(userIdentityKeys(user));
  return studentIdentityKeys(student).some((key) => userKeys.has(key));
}

function sameSchoolId(left, right) {
  const a = asTrimmed(left);
  const b = asTrimmed(right);
  return Boolean(a) && Boolean(b) && a === b;
}

function findActiveStudentProfileForUser(students = [], user = {}, schoolId) {
  const sid = asTrimmed(schoolId ?? user.school_id ?? user.schoolId);
  if (!sid || !user) return null;
  const userSchool = asTrimmed(user.school_id ?? user.schoolId);
  if (userSchool && !sameSchoolId(userSchool, sid)) return null;
  return (
    (students ?? []).find((student) => {
      if (!sameSchoolId(student.school_id ?? student.schoolId, sid)) return false;
      if (!isActiveStudentStatus(student.status)) return false;
      return userMatchesStudent(user, student);
    }) ?? null
  );
}

function findActiveTeacherProfileForUser(teachers = [], userId, schoolId) {
  const uid = asTrimmed(userId);
  const sid = asTrimmed(schoolId);
  if (!uid) return null;
  return (
    (teachers ?? []).find((teacher) => {
      if (asTrimmed(teacher.user_id ?? teacher.userId) !== uid) return false;
      if (sid && !sameSchoolId(teacher.school_id ?? teacher.schoolId, sid)) return false;
      return isActiveTeacherStatus(teacher.status);
    }) ?? null
  );
}

function mapLinkedStudent(row) {
  if (!row) return null;
  return {
    studentId: asTrimmed(row.id ?? row.student_id ?? row.studentId),
    studentCode: studentCodeOf(row),
    status: asTrimmed(row.status) || "active",
  };
}

function mapLinkedTeacher(row) {
  if (!row) return null;
  return {
    teacherId: asTrimmed(row.id ?? row.teacher_id ?? row.teacherId),
    teacherCode: asTrimmed(row.teacher_code ?? row.teacherCode),
    status: asTrimmed(row.status) || "active",
  };
}

function resolveAccountKind({ linkedStudent, linkedTeacher, roleKeys = [] } = {}) {
  if (linkedStudent && linkedTeacher) return "conflict";
  if (linkedStudent) return "student_login";
  if (linkedTeacher) return "teacher";
  const keys = (roleKeys ?? []).map((key) => asTrimmed(key).toUpperCase());
  if (keys.includes("STUDENT")) return "student_login";
  if (keys.includes("TEACHER")) return "teacher";
  if (keys.length) return "staff";
  return "unassigned";
}

const BUSINESS_PROFILE_KIND_LABELS = Object.freeze({
  student_login: "Compte lié à un élève",
  teacher: "Profil enseignant",
  staff: "Compte staff",
  unassigned: "Sans affectation",
  conflict: "Conflit élève + enseignant",
});

const ACCESS_ROLES_NONE_LABEL = "Aucun rôle d'accès";

function businessProfileKindLabel(kind) {
  const key = asTrimmed(kind);
  return BUSINESS_PROFILE_KIND_LABELS[key] || BUSINESS_PROFILE_KIND_LABELS.unassigned;
}

function emptyBusinessProfile(roleKeys = []) {
  const accountKind = resolveAccountKind({ roleKeys });
  return {
    accountKind,
    businessProfileLabel: businessProfileKindLabel(accountKind),
    linkedStudent: null,
    linkedTeacher: null,
    businessProfileConflict: false,
  };
}

function buildBusinessProfile({ studentRow, teacherRow, roleKeys = [] } = {}) {
  const linkedStudent = mapLinkedStudent(studentRow);
  const linkedTeacher = mapLinkedTeacher(teacherRow);
  const accountKind = resolveAccountKind({ linkedStudent, linkedTeacher, roleKeys });
  return {
    accountKind,
    businessProfileLabel: businessProfileKindLabel(accountKind),
    linkedStudent,
    linkedTeacher,
    businessProfileConflict: accountKind === "conflict",
  };
}

function studentToTeacherConflict(studentRow) {
  return {
    status: 409,
    code: BUSINESS_PROFILE_CONFLICT,
    message: STUDENT_TO_TEACHER_MESSAGE,
    details: {
      direction: "student_to_teacher",
      studentCode: studentCodeOf(studentRow),
      studentId: asTrimmed(studentRow?.id ?? studentRow?.student_id),
    },
  };
}

function teacherToStudentConflict(teacherRow) {
  return {
    status: 409,
    code: BUSINESS_PROFILE_CONFLICT,
    message: TEACHER_TO_STUDENT_MESSAGE,
    details: {
      direction: "teacher_to_student",
      teacherCode: asTrimmed(teacherRow?.teacher_code ?? teacherRow?.teacherCode),
      teacherId: asTrimmed(teacherRow?.id ?? teacherRow?.teacher_id),
    },
  };
}

function isBusinessProfileConflictError(error) {
  if (!error) return false;
  if (error.code === BUSINESS_PROFILE_CONFLICT) return true;
  return String(error.message ?? "").includes(BUSINESS_PROFILE_CONFLICT);
}

function isOptionalProfileLookupError(error) {
  const code = String(error?.code ?? "");
  return code === "42P01" || code === "42703";
}

const ACTIVE_STUDENT_SQL = `
  COALESCE(st.status, 'active') NOT IN ('inactive', 'deleted', 'archived', 'closed', 'transferred')
`;

const ACTIVE_TEACHER_SQL = `
  COALESCE(t.status, 'active') NOT IN ('inactive', 'deleted', 'archived')
`;

const STUDENT_USER_MATCH_SQL = `
  (
    NULLIF(to_jsonb(st)->>'user_id', '') = u.id::text
    OR st.student_code = u.user_code
    OR st.student_code = NULLIF(to_jsonb(u)->>'identity_code', '')
    OR st.student_code = NULLIF(to_jsonb(u)->>'login_code', '')
    OR NULLIF(to_jsonb(st)->>'identity_code', '') = u.user_code
    OR NULLIF(to_jsonb(st)->>'login_code', '') = u.user_code
    OR NULLIF(to_jsonb(st)->>'identity_code', '') = NULLIF(to_jsonb(u)->>'identity_code', '')
    OR NULLIF(to_jsonb(st)->>'login_code', '') = NULLIF(to_jsonb(u)->>'login_code', '')
  )
`;

const SELECT_ACTIVE_STUDENT_FOR_USER_SQL = `
  SELECT st.id, st.student_code, st.status, st.school_id
  FROM students st
  JOIN users u ON u.school_id = st.school_id AND ${STUDENT_USER_MATCH_SQL}
  WHERE u.id = $1
    AND st.school_id = $2
    AND ${ACTIVE_STUDENT_SQL}
  LIMIT 1
`;

const SELECT_ACTIVE_TEACHER_FOR_USER_SQL = `
  SELECT t.id, t.teacher_code, t.status, t.school_id, t.user_id
  FROM teachers t
  WHERE t.user_id = $1
    AND t.school_id = $2
    AND ${ACTIVE_TEACHER_SQL}
  LIMIT 1
`;

const SELECT_ACTIVE_TEACHER_OCCUPYING_CODE_SQL = `
  SELECT t.id, t.teacher_code, t.status, t.school_id, t.user_id
  FROM teachers t
  JOIN users u ON u.id = t.user_id AND u.school_id = t.school_id
  WHERE t.school_id = $1
    AND ${ACTIVE_TEACHER_SQL}
    AND (
      u.user_code = $2
      OR NULLIF(to_jsonb(u)->>'identity_code', '') = $2
      OR NULLIF(to_jsonb(u)->>'login_code', '') = $2
    )
  LIMIT 1
`;

const SELECT_STUDENT_PROFILES_FOR_USERS_SQL = `
  SELECT u.id AS user_id, st.id AS student_id, st.student_code, st.status, st.school_id
  FROM users u
  JOIN students st ON st.school_id = u.school_id AND ${STUDENT_USER_MATCH_SQL}
  WHERE u.id = ANY($1::uuid[])
    AND ${ACTIVE_STUDENT_SQL}
`;

const SELECT_TEACHER_PROFILES_FOR_USERS_SQL = `
  SELECT t.user_id, t.id AS teacher_id, t.teacher_code, t.status, t.school_id
  FROM teachers t
  WHERE t.user_id = ANY($1::uuid[])
    AND ${ACTIVE_TEACHER_SQL}
`;

module.exports = {
  BUSINESS_PROFILE_CONFLICT,
  STUDENT_TO_TEACHER_MESSAGE,
  TEACHER_TO_STUDENT_MESSAGE,
  isActiveStudentStatus,
  isActiveTeacherStatus,
  studentCodeOf,
  userIdentityKeys,
  userMatchesStudentCode,
  userMatchesStudent,
  findActiveStudentProfileForUser,
  findActiveTeacherProfileForUser,
  resolveAccountKind,
  businessProfileKindLabel,
  BUSINESS_PROFILE_KIND_LABELS,
  ACCESS_ROLES_NONE_LABEL,
  emptyBusinessProfile,
  buildBusinessProfile,
  studentToTeacherConflict,
  teacherToStudentConflict,
  isBusinessProfileConflictError,
  isOptionalProfileLookupError,
  SELECT_ACTIVE_STUDENT_FOR_USER_SQL,
  SELECT_ACTIVE_TEACHER_FOR_USER_SQL,
  SELECT_ACTIVE_TEACHER_OCCUPYING_CODE_SQL,
  SELECT_STUDENT_PROFILES_FOR_USERS_SQL,
  SELECT_TEACHER_PROFILES_FOR_USERS_SQL,
};
