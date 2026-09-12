"use strict";

const { createHttpError, asTrimmedString, requireClassCodeParam } = require("./classesManagement");
const { sqlTeacherPublicCodeEquals } = require("./teacherCodeAllocation");

const HEAD_TEACHER_ERROR = Object.freeze({
  CLASS_INACTIVE: "HEAD_TEACHER_CLASS_INACTIVE",
  TEACHER_INACTIVE: "HEAD_TEACHER_TEACHER_INACTIVE",
  TEACHER_OTHER_SCHOOL: "HEAD_TEACHER_OTHER_SCHOOL",
  TEACHER_REQUIRED: "HEAD_TEACHER_TEACHER_REQUIRED",
  TENANT_FIELD_FORBIDDEN: "HEAD_TEACHER_TENANT_FIELD_FORBIDDEN",
  POSTGRES_REQUIRED: "HEAD_TEACHER_POSTGRES_REQUIRED",
});

const UNASSIGNED_HEAD_TEACHER_LABEL = "Non assigné";

const HEAD_TEACHER_WRITE_PERMISSIONS = Object.freeze([
  "Classes:UPDATE",
  "Gérer classes",
  "Affectations:CREATE",
  "Affectations:UPDATE",
  "Gérer affectations",
  "ALL_PRIVILEGES",
]);

const HEAD_TEACHER_CANDIDATES_ROUTE = "GET /api/classes/:classCode/head-teacher/candidates";
const HEAD_TEACHER_ASSIGN_ROUTE = "PUT /api/classes/:classCode/head-teacher";
const HEAD_TEACHER_REMOVE_ROUTE = "DELETE /api/classes/:classCode/head-teacher";

const FORBIDDEN_TENANT_FIELDS = Object.freeze([
  "schoolCode",
  "schoolId",
  "academicYearId",
  "classCode",
  "classId",
]);

const CLASS_HEAD_TEACHERS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS class_head_teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  class_id UUID NOT NULL REFERENCES classes(id),
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_class_head_teachers_one_active
  ON class_head_teachers (class_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_class_head_teachers_school_teacher
  ON class_head_teachers (school_id, teacher_id, status);
`;

/** Tables minimales pour que CLASS_SELECT (JOIN LATERAL PP) parse en tests PG isolés. */
const CLASS_HEAD_TEACHERS_LIST_JOIN_FIXTURE_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT,
  last_name TEXT,
  status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  user_id UUID REFERENCES users(id),
  teacher_code VARCHAR(64) NOT NULL,
  status TEXT DEFAULT 'active'
);
${CLASS_HEAD_TEACHERS_SCHEMA_SQL}
`;

const ACTIVE_TEACHER_STATUS_SQL = `
  lower(btrim(COALESCE(t.status, 'active'))) IN ('active', 'actif')
  AND (
    u.id IS NULL
    OR lower(btrim(COALESCE(u.status, 'active'))) IN ('active', 'actif')
  )
`;

/**
 * @param {unknown} firstName
 * @param {unknown} lastName
 * @returns {string}
 */
function formatHeadTeacherDisplayName(firstName, lastName) {
  const first = asTrimmedString(firstName);
  const last = asTrimmedString(lastName);
  const lastDisplay = last ? last.toLocaleUpperCase("fr") : "";
  return [first, lastDisplay].filter(Boolean).join(" ");
}

/**
 * @param {unknown} status
 * @returns {boolean}
 */
function isActiveTeacherStatus(status) {
  const normalized = asTrimmedString(status)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return normalized === "active" || normalized === "actif";
}

/**
 * @param {unknown} status
 * @returns {boolean}
 */
function isActiveClassStatus(status) {
  return asTrimmedString(status).toLowerCase() === "active";
}

function headTeacherPostgresRequired() {
  return createHttpError(
    503,
    "Affectation du professeur principal disponible uniquement sur PostgreSQL.",
    HEAD_TEACHER_ERROR.POSTGRES_REQUIRED,
  );
}

/**
 * @param {unknown} body
 * @returns {{ teacherCode: string }}
 */
function validateAssignHeadTeacherInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createHttpError(400, "Affectation invalide.", HEAD_TEACHER_ERROR.TEACHER_REQUIRED);
  }
  const forbidden = FORBIDDEN_TENANT_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (forbidden.length) {
    throw createHttpError(
      400,
      `Champ de périmètre interdit: ${forbidden[0]}.`,
      HEAD_TEACHER_ERROR.TENANT_FIELD_FORBIDDEN,
    );
  }
  const teacherCode = asTrimmedString(body.teacherCode ?? body.teacherId);
  if (!teacherCode) {
    throw createHttpError(
      400,
      "Enseignant obligatoire.",
      HEAD_TEACHER_ERROR.TEACHER_REQUIRED,
    );
  }
  return { teacherCode };
}

function assertClassAcceptsHeadTeacherAssignment(schoolClass) {
  if (!schoolClass) {
    throw createHttpError(404, "Classe introuvable.");
  }
  if (!isActiveClassStatus(schoolClass.status)) {
    throw createHttpError(
      409,
      "Une classe désactivée ne peut pas recevoir de nouvelle affectation.",
      HEAD_TEACHER_ERROR.CLASS_INACTIVE,
    );
  }
}

function assertTeacherEligibleForHeadTeacher(teacher, schoolId) {
  if (!teacher) {
    throw createHttpError(404, "Enseignant introuvable.");
  }
  if (String(teacher.school_id) !== String(schoolId)) {
    throw createHttpError(
      403,
      "Impossible d'affecter un enseignant d'un autre établissement.",
      HEAD_TEACHER_ERROR.TEACHER_OTHER_SCHOOL,
    );
  }
  if (!isActiveTeacherStatus(teacher.status) || (teacher.user_status && !isActiveTeacherStatus(teacher.user_status))) {
    throw createHttpError(
      409,
      "Seuls les enseignants actifs de l'établissement peuvent être affectés.",
      HEAD_TEACHER_ERROR.TEACHER_INACTIVE,
    );
  }
}

/**
 * @param {string[]} otherClassNames
 * @returns {string}
 */
function formatAlreadyHeadTeacherHint(otherClassNames) {
  const names = (otherClassNames ?? []).map((name) => asTrimmedString(name)).filter(Boolean);
  if (!names.length) return "";
  return `Déjà professeur principal de ${names.join(", ")}`;
}

module.exports = {
  HEAD_TEACHER_ERROR,
  UNASSIGNED_HEAD_TEACHER_LABEL,
  HEAD_TEACHER_WRITE_PERMISSIONS,
  HEAD_TEACHER_CANDIDATES_ROUTE,
  HEAD_TEACHER_ASSIGN_ROUTE,
  HEAD_TEACHER_REMOVE_ROUTE,
  CLASS_HEAD_TEACHERS_SCHEMA_SQL,
  CLASS_HEAD_TEACHERS_LIST_JOIN_FIXTURE_SQL,
  ACTIVE_TEACHER_STATUS_SQL,
  formatHeadTeacherDisplayName,
  formatAlreadyHeadTeacherHint,
  isActiveTeacherStatus,
  isActiveClassStatus,
  headTeacherPostgresRequired,
  validateAssignHeadTeacherInput,
  assertClassAcceptsHeadTeacherAssignment,
  assertTeacherEligibleForHeadTeacher,
  requireClassCodeParam,
  sqlTeacherPublicCodeEquals,
  createHttpError,
  asTrimmedString,
};
