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
  ATTENDANCE_DUPLICATE: "ATTENDANCE_DUPLICATE",
  EVALUATION_NOT_VALIDATED: "EVALUATION_NOT_VALIDATED",
  EVALUATION_VALIDATION_FORBIDDEN: "EVALUATION_VALIDATION_FORBIDDEN",
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
