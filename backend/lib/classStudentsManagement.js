"use strict";

const { createHttpError, asTrimmedString, requireClassCodeParam } = require("./classesManagement");

const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 40;
const MAX_EMAIL_LENGTH = 200;
const VALID_GENDERS = new Set(["Masculin", "Féminin", "Autre", ""]);

const FORBIDDEN_BODY_KEYS = Object.freeze([
  "classCode",
  "class_code",
  "classId",
  "class_id",
  "className",
  "class_name",
  "schoolCode",
  "school_code",
  "schoolId",
  "school_id",
  "academicYearId",
  "academic_year_id",
  "academicYearName",
  "academic_year_name",
  "enrollmentId",
  "enrollment_id",
]);

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
 * @returns {{ year: number, month: number, day: number } | null}
 */
function parseBirthDateParts(value) {
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

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
    };
  }

  const fr = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (fr) {
    return {
      year: Number(fr[3]),
      month: Number(fr[2]),
      day: Number(fr[1]),
    };
  }

  throw createHttpError(400, "birthDate invalide (format attendu AAAA-MM-JJ ou JJ-MM-AAAA).");
}

/**
 * @param {unknown} value
 * @returns {string | null} ISO date YYYY-MM-DD
 */
function parseAndValidateBirthDate(value) {
  const parts = parseBirthDateParts(value);
  if (!parts) {
    return null;
  }

  const { year, month, day } = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw createHttpError(400, "birthDate invalide (date impossible).");
  }

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() > todayUtc) {
    throw createHttpError(400, "birthDate invalide (date future interdite).");
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Toute présence d'un champ de périmètre dans le corps est interdite (même vide).
 * @param {unknown} body
 */
function assertEnrollmentScopeImmutable(body) {
  if (!isPlainObject(body)) {
    throw createHttpError(400, "Corps de requête invalide.");
  }

  for (const key of FORBIDDEN_BODY_KEYS) {
    if (Object.hasOwn(body, key)) {
      throw createHttpError(
        400,
        `${key} ne peut pas être fourni : le périmètre est imposé par la classe ouverte.`,
      );
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
  requireClassCodeParam(classCodeParam);
  const resolvedSchoolCode = asTrimmedString(schoolCode);
  if (!resolvedSchoolCode || resolvedSchoolCode === "*") {
    throw createHttpError(400, "schoolCode établissement requis.");
  }

  assertEnrollmentScopeImmutable(body);

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
    birthDate: parseAndValidateBirthDate(body.birthDate ?? body.birth_date),
    parentPhone: optionalStringField(
      body.parentPhone ?? body.parent_phone ?? body.phone,
      "parentPhone",
      MAX_PHONE_LENGTH,
    ),
    parentEmail: optionalStringField(
      body.parentEmail ?? body.parent_email ?? body.email,
      "parentEmail",
      MAX_EMAIL_LENGTH,
    ),
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
  if (!yearStatus || !["open", "active"].includes(yearStatus)) {
    throw createHttpError(409, "L'année scolaire de la classe n'est pas valide pour une inscription.");
  }
}

module.exports = {
  FORBIDDEN_BODY_KEYS,
  validateEnrollStudentInput,
  assertEnrollmentScopeImmutable,
  assertClassEligibleForEnrollment,
  parseAndValidateBirthDate,
};
