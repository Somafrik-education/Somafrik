"use strict";

const { validateTeacherSchoolEntry } = require("./teacherEntryRules");
const { validateAccountSecret } = require("./userAccountRules");

const MAX_NAME_LENGTH = 120;
const MAX_PHONE_LENGTH = 40;
const MAX_EMAIL_LENGTH = 200;
const MAX_SPECIALITY_LENGTH = 200;
const VALID_GENDERS = new Set(["Masculin", "Féminin", "Autre", ""]);

const FORBIDDEN_BODY_KEYS = Object.freeze([
  "schoolCode",
  "school_code",
  "schoolId",
  "school_id",
  "role",
  "teacherCode",
  "teacher_code",
  "identifier",
  "publicId",
  "public_id",
  "userId",
  "user_id",
  "userCode",
  "user_code",
  "id",
  "mustChangePassword",
  "must_change_password",
  "passwordHash",
  "password_hash",
  "pinHash",
  "pin_hash",
  "assignments",
  "assignedClasses",
  "classCode",
  "class_code",
  "classId",
  "class_id",
  "subjectId",
  "subject_id",
]);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {number} statusCode
 * @param {string} message
 * @param {string} [code]
 * @returns {Error & { statusCode: number, code?: string }}
 */
function createTeacherHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  return error;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxLength
 * @returns {string}
 */
function requireNonEmptyString(value, field, maxLength) {
  if (typeof value !== "string") {
    throw createTeacherHttpError(400, `Champ obligatoire: ${field}.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw createTeacherHttpError(400, `Champ obligatoire: ${field}.`);
  }
  if (trimmed.length > maxLength) {
    throw createTeacherHttpError(400, `${field} trop long (max ${maxLength}).`);
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
    throw createTeacherHttpError(400, `${field} doit être une chaîne.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw createTeacherHttpError(400, `${field} trop long (max ${maxLength}).`);
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
    throw createTeacherHttpError(400, "gender doit être une chaîne.");
  }
  const trimmed = value.trim();
  if (!VALID_GENDERS.has(trimmed)) {
    throw createTeacherHttpError(400, 'gender invalide: valeurs attendues "Masculin", "Féminin" ou "Autre".');
  }
  return trimmed || null;
}

/**
 * @param {unknown} value
 * @returns {{ year: number, month: number, day: number } | null}
 */
function parseDateParts(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw createTeacherHttpError(400, `${field} doit être une chaîne.`);
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

  throw createTeacherHttpError(400, `${field} invalide (format attendu AAAA-MM-JJ ou JJ-MM-AAAA).`);
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ allowFuture?: boolean, required?: boolean }} [options]
 * @returns {string | null} ISO date YYYY-MM-DD
 */
function parseAndValidateDate(value, field, options = {}) {
  const parts = parseDateParts(value, field);
  if (!parts) {
    if (options.required) {
      throw createTeacherHttpError(400, `Champ obligatoire: ${field}.`);
    }
    return null;
  }

  const { year, month, day } = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw createTeacherHttpError(400, `${field} invalide (date impossible).`);
  }

  if (options.allowFuture !== true) {
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (date.getTime() > todayUtc) {
      throw createTeacherHttpError(400, `${field} invalide (date future interdite).`);
    }
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Toute présence d'un champ technique / tenant dans le corps est interdite.
 * @param {unknown} body
 */
function assertTeacherCreateScopeImmutable(body) {
  if (!isPlainObject(body)) {
    throw createTeacherHttpError(400, "Corps de requête invalide.");
  }

  for (const key of FORBIDDEN_BODY_KEYS) {
    if (Object.hasOwn(body, key)) {
      throw createTeacherHttpError(
        400,
        `${key} ne peut pas être fourni : établissement, rôle et identifiants sont imposés côté serveur.`,
      );
    }
  }
}

/**
 * @returns {string} ISO date YYYY-MM-DD (UTC calendar day)
 */
function todayIsoDate() {
  const today = new Date();
  return `${String(today.getUTCFullYear()).padStart(4, "0")}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
}

/**
 * @param {unknown} body
 * @param {string} schoolCode
 * @returns {{
 *   firstName: string,
 *   lastName: string,
 *   gender: string | null,
 *   birthDate: string,
 *   entryDate: string,
 *   phone: string | null,
 *   email: string | null,
 *   speciality: string | null,
 *   temporaryPassword: string,
 * }}
 */
function validateCreateTeacherInput(body, schoolCode) {
  const resolvedSchoolCode = String(schoolCode ?? "").trim();
  if (!resolvedSchoolCode || resolvedSchoolCode === "*") {
    throw createTeacherHttpError(400, "schoolCode établissement requis.");
  }

  assertTeacherCreateScopeImmutable(body);

  const firstName = requireNonEmptyString(
    body.firstName ?? body.first_name,
    "firstName",
    MAX_NAME_LENGTH,
  );
  const lastName = requireNonEmptyString(
    body.lastName ?? body.last_name ?? body.name,
    "lastName",
    MAX_NAME_LENGTH,
  );
  const birthDate = parseAndValidateDate(body.birthDate ?? body.birth_date, "birthDate", {
    required: true,
  });
  const entryDate =
    parseAndValidateDate(body.entryDate ?? body.entry_date ?? body.hireDate ?? body.hire_date, "entryDate") ??
    todayIsoDate();

  const ageError = validateTeacherSchoolEntry({ birthDate, entryDate });
  if (ageError) {
    throw createTeacherHttpError(400, ageError);
  }

  const phone = optionalStringField(body.phone, "phone", MAX_PHONE_LENGTH);
  const email = optionalStringField(body.email, "email", MAX_EMAIL_LENGTH);
  if (!phone && !email) {
    throw createTeacherHttpError(400, "Au moins un moyen de contact est requis (phone ou email).");
  }

  const temporaryPasswordRaw = body.temporaryPassword ?? body.temporary_password ?? body.password;
  if (typeof temporaryPasswordRaw !== "string" || !temporaryPasswordRaw.trim()) {
    throw createTeacherHttpError(400, "Champ obligatoire: temporaryPassword.");
  }
  const temporaryPassword = temporaryPasswordRaw.trim();
  const secretError = validateAccountSecret(temporaryPassword);
  if (secretError) {
    throw createTeacherHttpError(400, secretError);
  }

  return {
    firstName,
    lastName,
    gender: optionalGender(body.gender),
    birthDate,
    entryDate,
    phone,
    email,
    speciality: optionalStringField(
      body.speciality ?? body.specialty ?? body.mainSubject ?? body.main_subject,
      "speciality",
      MAX_SPECIALITY_LENGTH,
    ),
    temporaryPassword,
  };
}

/**
 * Normalisation identité pour détection d'ambiguïté (homonymes avec même naissance).
 * @param {string} value
 */
function normalizeIdentityPart(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {{ firstName?: string, lastName?: string, birthDate?: string, gender?: string | null }} candidate
 * @param {{ firstName?: string, lastName?: string, birthDate?: string, gender?: string | null }} existing
 */
function isExactTeacherCivilIdentity(candidate, existing) {
  if (
    normalizeIdentityPart(candidate.firstName) !== normalizeIdentityPart(existing.firstName) ||
    normalizeIdentityPart(candidate.lastName) !== normalizeIdentityPart(existing.lastName)
  ) {
    return false;
  }
  const candidateBirth = String(candidate.birthDate ?? "").trim();
  const existingBirth = String(existing.birthDate ?? "").trim();
  if (!candidateBirth || !existingBirth || candidateBirth !== existingBirth) {
    return false;
  }
  const candidateGender = normalizeIdentityPart(candidate.gender);
  const existingGender = normalizeIdentityPart(existing.gender);
  if (candidateGender && existingGender && candidateGender !== existingGender) {
    return false;
  }
  return true;
}

module.exports = {
  FORBIDDEN_BODY_KEYS,
  createTeacherHttpError,
  validateCreateTeacherInput,
  assertTeacherCreateScopeImmutable,
  parseAndValidateDate,
  isExactTeacherCivilIdentity,
  normalizeIdentityPart,
  todayIsoDate,
};
