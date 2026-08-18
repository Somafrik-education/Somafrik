"use strict";

/**
 * Téléphone parent — validation internationale raisonnable.
 * Caractères autorisés : chiffres, espaces, +, -, ().
 * Au moins 8 chiffres, au plus 15 (E.164). Valeur vide = optionnel.
 */

const { createHttpError } = require("./classesManagement");

const MAX_PHONE_LENGTH = 40;
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;
const PARENT_PHONE_ALLOWED_RE = /^[0-9+()\s-]+$/;

const PARENT_PHONE_INVALID_MESSAGE =
  "parentPhone invalide : saisissez un numéro de téléphone (chiffres, espaces, +, - ou parenthèses).";

/**
 * @param {string} trimmed
 * @returns {boolean}
 */
function isValidParentPhoneNumber(trimmed) {
  const value = String(trimmed ?? "").trim();
  if (!value) return false;
  if (value.length > MAX_PHONE_LENGTH) return false;
  if (!PARENT_PHONE_ALLOWED_RE.test(value)) return false;
  const plusCount = (value.match(/\+/g) || []).length;
  if (plusCount > 1) return false;
  if (plusCount === 1 && !value.startsWith("+")) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}

/**
 * @param {unknown} value
 * @param {string} [field]
 * @returns {string | null}
 */
function optionalParentPhone(value, field = "parentPhone") {
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
  if (trimmed.length > MAX_PHONE_LENGTH) {
    throw createHttpError(400, `${field} trop long (max ${MAX_PHONE_LENGTH}).`);
  }
  if (!isValidParentPhoneNumber(trimmed)) {
    throw createHttpError(400, PARENT_PHONE_INVALID_MESSAGE);
  }
  return trimmed;
}

module.exports = {
  MAX_PHONE_LENGTH,
  MIN_PHONE_DIGITS,
  MAX_PHONE_DIGITS,
  PARENT_PHONE_INVALID_MESSAGE,
  isValidParentPhoneNumber,
  optionalParentPhone,
};
