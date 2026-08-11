"use strict";

const crypto = require("node:crypto");

const CLASS_STATUSES = Object.freeze(["active", "inactive"]);
const CLASS_STATUS_SET = new Set(CLASS_STATUSES);
const MAX_CLASS_CODE_LENGTH = 64;
const MAX_NAME_LENGTH = 200;
const MAX_LEVEL_LENGTH = 120;
const MAX_SECTION_LENGTH = 120;

/**
 * @param {unknown} value
 * @returns {string}
 */
function asTrimmedString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

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
 * @returns {Error & { statusCode: number }}
 */
function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Server-generated immutable class code.
 * @param {string} schoolCode
 * @returns {string}
 */
function generateClassCode(schoolCode) {
  const school = asTrimmedString(schoolCode).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  const code = `CLS-${school || "SCH"}-${stamp}${rand}`;
  return code.slice(0, MAX_CLASS_CODE_LENGTH);
}

/**
 * Exact status gate — no silent coercion from Active/Archivée/etc.
 * @param {unknown} value
 * @returns {"active" | "inactive"}
 */
function requireClassStatus(value) {
  if (typeof value !== "string" || !CLASS_STATUS_SET.has(value)) {
    throw createHttpError(400, 'Statut invalide: valeurs exactes "active" ou "inactive".');
  }
  return value;
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
  if (trimmed !== value) {
    // Leading/trailing whitespace rejected — no silent trim coercion for identity fields.
    // Name/level/section still trim for storage after validation of non-empty content:
    // we accept trim for storage of display fields below via asTrimmedString after this check
    // only when the raw value has content; reject pure whitespace.
  }
  return trimmed;
}

/**
 * Optional string field: omit/undefined → null; empty string after trim → null;
 * non-string → 400 (no coercion).
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
 * @param {unknown} body
 * @param {string} schoolCode
 * @returns {{
 *   schoolCode: string,
 *   name: string,
 *   academicYearName: string,
 *   level: string | null,
 *   section: string | null,
 *   status: "active" | "inactive",
 * }}
 */
function validateCreateClassInput(body, schoolCode) {
  if (!isPlainObject(body)) {
    throw createHttpError(400, "Corps de requête invalide.");
  }
  if (Object.hasOwn(body, "classCode") || Object.hasOwn(body, "id") || Object.hasOwn(body, "publicId")) {
    throw createHttpError(400, "classCode est généré côté serveur et ne peut pas être fourni.");
  }

  const resolvedSchoolCode = asTrimmedString(schoolCode);
  if (!resolvedSchoolCode || resolvedSchoolCode === "*") {
    throw createHttpError(400, "schoolCode établissement requis.");
  }

  if (Object.hasOwn(body, "schoolCode")) {
    const bodySchool = asTrimmedString(body.schoolCode);
    if (bodySchool && bodySchool !== resolvedSchoolCode) {
      throw createHttpError(403, "Accès refusé à un autre établissement.");
    }
  }

  const name = requireNonEmptyString(body.name, "name", MAX_NAME_LENGTH);
  const academicYearName = requireNonEmptyString(
    body.academicYearName,
    "academicYearName",
    MAX_NAME_LENGTH,
  );
  const level = optionalStringField(body.level, "level", MAX_LEVEL_LENGTH);
  const section = optionalStringField(
    body.section !== undefined ? body.section : body.track,
    "section",
    MAX_SECTION_LENGTH,
  );
  const status =
    body.status === undefined || body.status === null
      ? "active"
      : requireClassStatus(body.status);

  return {
    schoolCode: resolvedSchoolCode,
    name,
    academicYearName,
    level,
    section,
    status,
  };
}

/**
 * @param {unknown} body
 * @returns {{
 *   name?: string,
 *   level?: string | null,
 *   section?: string | null,
 *   status?: "active" | "inactive",
 * }}
 */
function validateUpdateClassInput(body) {
  if (!isPlainObject(body)) {
    throw createHttpError(400, "Corps de requête invalide.");
  }
  if (
    Object.hasOwn(body, "classCode") ||
    Object.hasOwn(body, "schoolCode") ||
    Object.hasOwn(body, "academicYearName") ||
    Object.hasOwn(body, "academicYearId")
  ) {
    throw createHttpError(400, "classCode, schoolCode et année scolaire sont immuables dans cette PR.");
  }

  /** @type {{ name?: string, level?: string | null, section?: string | null, status?: "active" | "inactive" }} */
  const patch = {};
  let touched = false;

  if (Object.hasOwn(body, "name")) {
    patch.name = requireNonEmptyString(body.name, "name", MAX_NAME_LENGTH);
    touched = true;
  }
  if (Object.hasOwn(body, "level")) {
    patch.level = optionalStringField(body.level, "level", MAX_LEVEL_LENGTH);
    touched = true;
  }
  if (Object.hasOwn(body, "section") || Object.hasOwn(body, "track")) {
    patch.section = optionalStringField(
      Object.hasOwn(body, "section") ? body.section : body.track,
      "section",
      MAX_SECTION_LENGTH,
    );
    touched = true;
  }
  if (Object.hasOwn(body, "status")) {
    patch.status = requireClassStatus(body.status);
    touched = true;
  }

  if (!touched) {
    throw createHttpError(400, "Aucun champ modifiable fourni (name, level, section, status).");
  }

  return patch;
}

/**
 * @param {unknown} classCode
 * @returns {string}
 */
function requireClassCodeParam(classCode) {
  const code = asTrimmedString(classCode);
  if (!code || code.length > MAX_CLASS_CODE_LENGTH) {
    throw createHttpError(400, "classCode invalide.");
  }
  return code;
}

module.exports = {
  CLASS_STATUSES,
  generateClassCode,
  validateCreateClassInput,
  validateUpdateClassInput,
  requireClassCodeParam,
  createHttpError,
  asTrimmedString,
};
