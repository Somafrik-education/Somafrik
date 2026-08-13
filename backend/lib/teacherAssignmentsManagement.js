"use strict";

function asString(value) {
  return String(value ?? "").trim();
}

function assignmentError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function validateAssignmentInput(body = {}, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw assignmentError(400, "Affectation invalide.", "ASSIGNMENT_INVALID");
  }
  const forbidden = ["schoolCode", "schoolId", "academicYearId"].filter((key) =>
    Object.prototype.hasOwnProperty.call(body, key),
  );
  if (forbidden.length) {
    throw assignmentError(
      400,
      `Champ de périmètre interdit: ${forbidden[0]}.`,
      "ASSIGNMENT_TENANT_FIELD_FORBIDDEN",
    );
  }

  const value = {
    teacherCode: asString(body.teacherCode ?? body.teacherId),
    classRef: asString(body.classCode ?? body.className),
    subjectRef: asString(body.subjectCode ?? body.subject ?? body.course),
    assignmentRole: asString(
      Object.prototype.hasOwnProperty.call(body, "assignmentRole")
        ? body.assignmentRole
        : partial
          ? ""
          : "primary",
    ),
  };
  const present = {
    teacherCode:
      Object.prototype.hasOwnProperty.call(body, "teacherCode") ||
      Object.prototype.hasOwnProperty.call(body, "teacherId"),
    classRef:
      Object.prototype.hasOwnProperty.call(body, "classCode") ||
      Object.prototype.hasOwnProperty.call(body, "className"),
    subjectRef:
      Object.prototype.hasOwnProperty.call(body, "subjectCode") ||
      Object.prototype.hasOwnProperty.call(body, "subject") ||
      Object.prototype.hasOwnProperty.call(body, "course"),
    assignmentRole: Object.prototype.hasOwnProperty.call(body, "assignmentRole"),
  };

  for (const field of ["teacherCode", "classRef", "subjectRef"]) {
    if ((!partial || present[field]) && !value[field]) {
      throw assignmentError(400, "Enseignant, classe et matière sont requis.", "ASSIGNMENT_FIELDS_REQUIRED");
    }
  }
  if (value.assignmentRole && !/^[a-z0-9_-]{1,32}$/i.test(value.assignmentRole)) {
    throw assignmentError(400, "Rôle d'affectation invalide.", "ASSIGNMENT_ROLE_INVALID");
  }
  return { ...value, present };
}

module.exports = { assignmentError, validateAssignmentInput };
