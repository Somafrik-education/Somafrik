"use strict";

const crypto = require("node:crypto");

const CLASS_STATUSES = Object.freeze(["active", "inactive"]);
const CLASS_STATUS_SET = new Set(CLASS_STATUSES);
const MAX_CLASS_CODE_LENGTH = 64;
const MAX_NAME_LENGTH = 200;
const FORBIDDEN_FREE_TEXT_FIELDS = Object.freeze([
  "name",
  "level",
  "section",
  "track",
  "academicYearName",
  "groupCode",
]);

const CLASS_WRITE_ERROR = Object.freeze({
  FREE_TEXT_FORBIDDEN: "CLASS_FREE_TEXT_FORBIDDEN",
  OFFERING_REQUIRED: "CLASS_OFFERING_REQUIRED",
  LEVEL_NOT_ACTIVATED: "CLASS_LEVEL_NOT_ACTIVATED",
  STREAM_NOT_ACTIVATED: "CLASS_STREAM_NOT_ACTIVATED",
  GROUP_NOT_ACTIVATED: "CLASS_GROUP_NOT_ACTIVATED",
  STREAM_LEVEL_MISMATCH: "CLASS_STREAM_LEVEL_MISMATCH",
  STRUCTURAL_DUPLICATE: "CLASS_STRUCTURAL_DUPLICATE",
});

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
 * @param {string} [code]
 * @returns {Error & { statusCode: number, code?: string }}
 */
function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
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
 * @param {unknown} body
 */
function assertNoFreeTextClassFields(body) {
  const present = FORBIDDEN_FREE_TEXT_FIELDS.filter((field) => Object.hasOwn(body, field));
  if (!present.length) return;
  throw createHttpError(
    400,
    "name, level, section, track, academicYearName et groupCode ne sont plus acceptés. " +
      "Utilisez academicYearId, levelId, streamId (optionnel) et groupId. " +
      "Le nom et le code groupe sont dérivés du référentiel.",
    CLASS_WRITE_ERROR.FREE_TEXT_FORBIDDEN,
  );
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireId(value, field) {
  const id = asTrimmedString(value);
  if (typeof value !== "string" || !id) {
    throw createHttpError(400, `Champ obligatoire: ${field}.`);
  }
  if (id.length > 64) {
    throw createHttpError(400, `${field} trop long.`);
  }
  return id;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalStreamId(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw createHttpError(400, "streamId doit être une chaîne.");
  }
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function requireGroupId(value) {
  // PR-1A : l'unicité NULL-safe n'autorise pas un groupId facultatif à l'API.
  return requireId(value, "groupId");
}

/**
 * Série métier pédagogique (A, B, C…) — fait partie du nom.
 * Les codes techniques legacy (ex. CD02) restent exclus du nom.
 * @param {unknown} value
 * @returns {boolean}
 */
function isPedagogicalSeriesCode(value) {
  return /^[A-Z]$/i.test(asTrimmedString(value));
}

/**
 * Nom d'affichage déterministe : `{niveau} {filière?} {série?}`.
 * La série métier A/B/C participe au nom pédagogique.
 * Un suffixe technique legacy (ex. CD02) n'est jamais concaténé.
 * @param {{ levelName: string, streamName?: string | null, groupCode?: string | null }} parts
 * @returns {string}
 */
function composeClassDisplayName(parts) {
  const levelName = asTrimmedString(parts?.levelName);
  const streamName = asTrimmedString(parts?.streamName);
  const groupCode = asTrimmedString(parts?.groupCode);
  const series = isPedagogicalSeriesCode(groupCode) ? groupCode.toUpperCase() : "";
  const composed = [levelName, streamName, series].filter(Boolean).join(" ");
  if (!composed) {
    throw createHttpError(500, "Impossible de composer le nom de classe.");
  }
  if (composed.length > MAX_NAME_LENGTH) {
    throw createHttpError(400, `Nom de classe trop long (max ${MAX_NAME_LENGTH}).`);
  }
  return composed;
}

/**
 * @param {unknown} body
 * @param {string} schoolCode
 * @returns {{
 *   schoolCode: string,
 *   academicYearId: string,
 *   levelId: string,
 *   streamId: string | null,
 *   groupId: string,
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
  assertNoFreeTextClassFields(body);

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

  const status =
    body.status === undefined || body.status === null
      ? "active"
      : requireClassStatus(body.status);

  return {
    schoolCode: resolvedSchoolCode,
    academicYearId: requireId(body.academicYearId, "academicYearId"),
    levelId: requireId(body.levelId, "levelId"),
    streamId: optionalStreamId(body.streamId),
    groupId: requireGroupId(body.groupId),
    status,
  };
}

/**
 * @param {unknown} body
 * @returns {{
 *   levelId?: string,
 *   streamId?: string | null,
 *   groupId?: string,
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
    throw createHttpError(400, "classCode, schoolCode et année scolaire sont immuables.");
  }
  assertNoFreeTextClassFields(body);

  /** @type {{ levelId?: string, streamId?: string | null, groupId?: string, status?: "active" | "inactive" }} */
  const patch = {};
  let touched = false;

  if (Object.hasOwn(body, "levelId")) {
    patch.levelId = requireId(body.levelId, "levelId");
    touched = true;
  }
  if (Object.hasOwn(body, "streamId")) {
    patch.streamId = optionalStreamId(body.streamId);
    touched = true;
  }
  if (Object.hasOwn(body, "groupId")) {
    patch.groupId = requireGroupId(body.groupId);
    touched = true;
  }
  if (Object.hasOwn(body, "status")) {
    patch.status = requireClassStatus(body.status);
    touched = true;
  }

  if (!touched) {
    throw createHttpError(400, "Aucun champ modifiable fourni (levelId, streamId, groupId, status).");
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
  CLASS_WRITE_ERROR,
  FORBIDDEN_FREE_TEXT_FIELDS,
  generateClassCode,
  validateCreateClassInput,
  validateUpdateClassInput,
  requireClassCodeParam,
  composeClassDisplayName,
  isPedagogicalSeriesCode,
  createHttpError,
  asTrimmedString,
};