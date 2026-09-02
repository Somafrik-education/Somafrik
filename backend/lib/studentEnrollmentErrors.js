"use strict";

const { createHttpError } = require("./classesManagement");

const ENROLL_IDENTITY_UNIQUE_CONSTRAINTS = new Set([
  "users_identity_code_unique",
  "users_school_login_code_unique",
  "users_user_code_key",
  "students_student_code_key",
  "students_identity_code_unique",
  "students_school_login_code_unique",
]);

/**
 * @param {unknown} error
 */
function logStudentEnrollmentPgError(error) {
  const err = error && typeof error === "object" ? error : {};
  console.error("[enroll-student] postgres", {
    code: err.code ?? null,
    constraint: err.constraint ?? null,
    detail: err.detail ?? null,
    table: err.table ?? null,
    column: err.column ?? null,
    where: err.where ?? null,
    routine: err.routine ?? null,
    schema: err.schema ?? null,
    message: err.message ?? String(error),
  });
}

/**
 * Erreurs métier connues → 4xx stable. Le détail PostgreSQL reste côté logs.
 * @param {unknown} error
 * @returns {Error}
 */
function mapStudentEnrollmentPgError(error) {
  if (error && typeof error === "object" && error.statusCode) {
    return error;
  }
  const err = error && typeof error === "object" ? error : {};
  const code = String(err.code ?? "");
  const constraint = String(err.constraint ?? "");
  const message = String(err.message ?? "");
  const detail = String(err.detail ?? "");

  if (message.includes("STUDENT_INITIALS_REQUIRED")) {
    return createHttpError(400, "Le nom et le prénom sont requis pour attribuer le matricule.", "STUDENT_INITIALS_REQUIRED");
  }
  if (message.includes("STUDENT_CODE_SERVER_GENERATED")) {
    return createHttpError(400, "Le matricule élève est attribué par le serveur.", "STUDENT_CODE_SERVER_GENERATED");
  }
  if (message.includes("SCHOOL_SHORT_CODE_REQUIRED") || message.includes("SCHOOL_NOT_FOUND")) {
    return createHttpError(409, "L'établissement n'a pas d'identifiant court valide.", "SCHOOL_SHORT_CODE_REQUIRED");
  }
  if (message.includes("STUDENT_SEQUENCE_EXHAUSTED")) {
    return createHttpError(409, "La séquence des matricules élèves est épuisée.", "STUDENT_SEQUENCE_EXHAUSTED");
  }
  if (message.includes("STUDENT_PERMANENT_IDENTIFIER_IMMUTABLE") || message.includes("STUDENT_CANONICAL_IDENTIFIER_IMMUTABLE")) {
    return createHttpError(409, "L'identifiant élève est immuable.", "STUDENT_PERMANENT_IDENTIFIER_IMMUTABLE");
  }
  if (message.includes("STUDENT_CANONICAL_IDENTIFIER_REQUIRED")) {
    return createHttpError(409, "Le compte élève doit reprendre le matricule PostgreSQL.", "STUDENT_CANONICAL_IDENTIFIER_REQUIRED");
  }

  if (code === "23505") {
    if (constraint === "uq_users_school_phone" || detail.includes("(phone)")) {
      return createHttpError(409, "Ce téléphone parent est déjà utilisé dans l'établissement.", "PARENT_PHONE_TAKEN");
    }
    if (constraint === "uq_users_school_email" || detail.includes("(email)")) {
      return createHttpError(409, "Cet e-mail parent est déjà utilisé dans l'établissement.", "PARENT_EMAIL_TAKEN");
    }
    if (ENROLL_IDENTITY_UNIQUE_CONSTRAINTS.has(constraint) || detail.includes("identity_code") || detail.includes("student_code") || detail.includes("user_code") || detail.includes("login_code")) {
      return createHttpError(409, "Impossible d'attribuer un matricule unique, réessayez.", "STUDENT_IDENTITY_TAKEN");
    }
    return createHttpError(409, "Conflit d'unicité lors de l'inscription.", "ENROLL_UNIQUE_CONFLICT");
  }

  if (code === "23514" && (constraint.includes("canonical_identifier") || message.includes("canonical_identifier"))) {
    return createHttpError(409, "L'identifiant élève généré est incompatible avec le schéma.", "STUDENT_IDENTITY_FORMAT");
  }

  return err instanceof Error ? err : new Error(String(error));
}

/**
 * @param {unknown} error
 * @returns {never}
 */
function rethrowEnrollmentError(error) {
  if (error && typeof error === "object" && error.statusCode) {
    throw error;
  }
  logStudentEnrollmentPgError(error);
  throw mapStudentEnrollmentPgError(error);
}

module.exports = {
  ENROLL_IDENTITY_UNIQUE_CONSTRAINTS,
  logStudentEnrollmentPgError,
  mapStudentEnrollmentPgError,
  rethrowEnrollmentError,
};
