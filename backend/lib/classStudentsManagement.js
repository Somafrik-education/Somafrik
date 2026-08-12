"use strict";

const { createHttpError, asTrimmedString, requireClassCodeParam } = require("./classesManagement");

const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 40;
const MAX_EMAIL_LENGTH = 200;
const VALID_GENDERS = new Set(["Masculin", "Féminin", "Autre", ""]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLength
 * @returns {string}
 */
function requireNonEmptyString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw createHttpError(400, `Champ obligatoire: ${field}.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw createHttpError(400, `Champ obligatoire: ${field}.`);
  }
  if (trimmed.length > maxLength) {
    throw createHttpError(400, `${field} trop long (max ${maxLength}).`);
  }
  return trimmed;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLength
 * @returns {string | null}
 */
function optionalStringField(value, field, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw createHttpError(400, `${field} doit être une chaîne.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw createHttpError(400, `${field} trop long (max ${maxLength}).`);
  }
  return trimmed;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalGender(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw createHttpError(400, "gender doit être une chaîne.");
  }
  const trimmed = value.trim();
  if (!VALID_GENDERS.has(trimmed)) {
    throw createHttpError(400, 'gender invalide: valeurs attendues "Masculin", "Féminin" ou "Autre".');
  }
  return trimmed || null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalBirthDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw createHttpError(400, "birthDate doit être une chaîne.");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
    throw createHttpError(400, "birthDate invalide (format attendu AAAA-MM-JJ ou JJ-MM-AAAA).");
  }
  return trimmed;
}

/**
 * Rejette toute tentative de falsifier le périmètre classe/établissement.
 * @param {unknown} body
 * @param {string} schoolCode
 * @param {string} classCode
 */
function assertEnrollmentScopeImmutable(body, schoolCode, classCode) {
  if (!isPlainObject(body)) {
    throw createHttpError(400, "Corps de requête invalide.");
  }

  const forbiddenKeys = [
    "classCode",
    "classId",
    "className",
    "schoolCode",
    "schoolId",
    "academicYearId",
    "academicYearName",
    "enrollmentId",
  ];
  for (const key of forbiddenKeys) {
    if (!Object.hasOwn(body, key)) continue;
    const provided = asTrimmedString(body[key]);
    if (!provided) continue;
    if (key === "classCode" && provided !== classCode) {
      throw createHttpError(403, "classCode immuable: inscription rattachée à la classe ouverte.");
    }
    if (key === "schoolCode") {
      const bodySchool = provided.toUpperCase();
      const principalSchool = asTrimmedString(schoolCode).toUpperCase();
      if (bodySchool && bodySchool !== principalSchool) {
        throw createHttpError(403, "Accès refusé à un autre établissement.");
      }
    }
    if (key !== "classCode" && key !== "schoolCode") {
      throw createHttpError(400, `${key} est déterminé par la classe et ne peut pas être fourni.`);
    }
  }
}

/**
 * @param {unknown} body
 * @param {string} schoolCode
 * @param {string} classCodeParam
 * @returns {{
 *   firstName: string,
 *   lastName: string,
 *   gender: string | null,
 *   birthDate: string | null,
 *   parentPhone: string | null,
 *   parentEmail: string | null,
 * }}
 */
function validateEnrollStudentInput(body, schoolCode, classCodeParam) {
  const classCode = requireClassCodeParam(classCodeParam);
  const resolvedSchoolCode = asTrimmedString(schoolCode);
  if (!resolvedSchoolCode || resolvedSchoolCode === "*") {
    throw createHttpError(400, "schoolCode établissement requis.");
  }

  assertEnrollmentScopeImmutable(body, resolvedSchoolCode, classCode);

  const firstName = requireNonEmptyString(
    body.firstName ?? body.first_name,
    "firstName",
    MAX_NAME_LENGTH,
  );
  const lastName = requireNonEmptyString(
    body.lastName ?? body.last_name,
    "lastName",
    MAX_NAME_LENGTH,
  );

  return {
    firstName,
    lastName,
    gender: optionalGender(body.gender),
    birthDate: optionalBirthDate(body.birthDate ?? body.birth_date),
    parentPhone: optionalStringField(body.parentPhone ?? body.parent_phone ?? body.phone, "parentPhone", MAX_PHONE_LENGTH),
    parentEmail: optionalStringField(body.parentEmail ?? body.parent_email ?? body.email, "parentEmail", MAX_EMAIL_LENGTH),
  };
}

/**
 * @param {{ status?: string, academic_year_status?: string }} classRow
 */
function assertClassEligibleForEnrollment(classRow) {
  if (!classRow) {
    throw createHttpError(404, "Classe introuvable.");
  }
  if (String(classRow.status ?? "").trim() !== "active") {
    throw createHttpError(409, "La classe doit être active pour inscrire un élève.");
  }
  const yearStatus = String(classRow.academic_year_status ?? classRow.academicYearStatus ?? "").trim();
  if (yearStatus && !["open", "active"].includes(yearStatus)) {
    throw createHttpError(409, "L'année scolaire de la classe n'est pas valide pour une inscription.");
  }
}

module.exports = {
  validateEnrollStudentInput,
  assertEnrollmentScopeImmutable,
  assertClassEligibleForEnrollment,
};
