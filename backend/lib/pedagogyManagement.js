"use strict";

const PEDAGOGY_ERROR = Object.freeze({
  TENANT_MISMATCH: "TENANT_MISMATCH",
  COURSE_NOT_FOUND: "COURSE_NOT_FOUND",
  COURSE_SCHEDULE_CONFLICT: "COURSE_SCHEDULE_CONFLICT",
  EVALUATION_NOT_FOUND: "EVALUATION_NOT_FOUND",
  GRADE_INVALID: "GRADE_INVALID",
  STUDENT_NOT_ENROLLED: "STUDENT_NOT_ENROLLED",
  TEACHER_ASSIGNMENT_REQUIRED: "TEACHER_ASSIGNMENT_REQUIRED",
  ACADEMIC_YEAR_CLOSED: "ACADEMIC_YEAR_CLOSED",
  PERIOD_NOT_FOUND: "PERIOD_NOT_FOUND",
  INVALID_DAY_OF_WEEK: "INVALID_DAY_OF_WEEK",
  INVALID_TIME_RANGE: "INVALID_TIME_RANGE",
  SCHOOL_COURSE_INACTIVE: "SCHOOL_COURSE_INACTIVE",
  ACADEMIC_YEAR_MISMATCH: "ACADEMIC_YEAR_MISMATCH",
  ATTENDANCE_DUPLICATE: "ATTENDANCE_DUPLICATE",
  EVALUATION_NOT_VALIDATED: "EVALUATION_NOT_VALIDATED",
  EVALUATION_VALIDATION_FORBIDDEN: "EVALUATION_VALIDATION_FORBIDDEN",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_INACTIVE: "ROOM_INACTIVE",
  ROOM_TEXT_DEPRECATED: "ROOM_TEXT_DEPRECATED",
  REPLACEMENT_NOT_FOUND: "REPLACEMENT_NOT_FOUND",
  REPLACEMENT_WEEKDAY_MISMATCH: "REPLACEMENT_WEEKDAY_MISMATCH",
  REPLACEMENT_DATE_OUT_OF_YEAR: "REPLACEMENT_DATE_OUT_OF_YEAR",
  SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT: "SUBSTITUTE_TEACHER_SCHEDULE_CONFLICT",
  REPLACEMENT_OCCURRENCE_CONFLICT: "REPLACEMENT_OCCURRENCE_CONFLICT",
  SUBSTITUTE_SAME_AS_ORIGINAL: "SUBSTITUTE_SAME_AS_ORIGINAL",
});

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function createPedagogyError(status, message, code, details) {
  const error = new Error(message);
  error.statusCode = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function ignoreClientScope(payload = {}) {
  const next = { ...payload };
  delete next.schoolId;
  delete next.schoolCode;
  delete next.createdBy;
  delete next.triggeredBy;
  return next;
}

function tenantSchoolCodeFromPrincipal(principal) {
  const code = asTrimmed(principal?.schoolCode);
  if (!code || code === "*") {
    throw createPedagogyError(400, "Établissement requis.", PEDAGOGY_ERROR.TENANT_MISMATCH);
  }
  return code.toUpperCase();
}

function pedagogyAuditMetaFromRequest(req) {
  return {
    ipAddress: req?.ip ?? req?.headers?.["x-forwarded-for"] ?? "",
    userAgent: req?.headers?.["user-agent"] ?? "",
  };
}

module.exports = {
  PEDAGOGY_ERROR,
  asTrimmed,
  createPedagogyError,
  ignoreClientScope,
  tenantSchoolCodeFromPrincipal,
  pedagogyAuditMetaFromRequest,
};
