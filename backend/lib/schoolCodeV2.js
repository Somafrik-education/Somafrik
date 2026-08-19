/**
 * Contrat établissement V2 — format public uniquement.
 *
 * Format : {ISO_PAYS}-{INITIALES}-{YY}-{SEQ3}
 * Exemple : CD-IN-26-001
 *
 * IN n'est PAS une constante d'un établissement donné : ce sont les initiales
 * déterministes de `somafrik_school_short_code` / `schoolShortCodeFromName`
 * (première lettre de chaque mot significatif, mots-outils DE/DU/DES/LA/LE/LES/D/ET ignorés).
 *
 * Allocation SEQ3 : PostgreSQL only (`somafrik_prepare_school_login_code`).
 * Ce module formate et valide. Il n'incrémente aucun compteur.
 */
"use strict";

const { schoolShortCodeFromName, identityYearShort } = require("./permanentIdentifier");

const V2_SCHOOL_LOGIN_PATTERN = /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2}-\d{3}$/;
const LEGACY_SCHOOL_CODE_PATTERN = /^[A-Z]{2}-\d{4}-\d{4}$/;

function normalizeSchoolCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isV2SchoolLoginCode(value) {
  return V2_SCHOOL_LOGIN_PATTERN.test(normalizeSchoolCode(value));
}

function isLegacySchoolCodeFormat(value) {
  return LEGACY_SCHOOL_CODE_PATTERN.test(normalizeSchoolCode(value));
}

function padSchoolSequence(sequence) {
  const numeric = Number(sequence);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 999) {
    const error = new Error(`SCHOOL_LOGIN_SEQUENCE_INVALID: ${sequence}`);
    error.code = "SCHOOL_LOGIN_SEQUENCE_INVALID";
    throw error;
  }
  return String(numeric).padStart(3, "0");
}

/**
 * Formate un login_code V2. Ne pas appeler depuis Web/Mobile pour allouer.
 * @param {{ countryIso: string, schoolName: string, year: number, sequence: number }} parts
 */
function formatSchoolLoginCode({ countryIso, schoolName, year, sequence }) {
  const iso = normalizeSchoolCode(countryIso).slice(0, 2);
  if (!/^[A-Z]{2}$/.test(iso)) {
    const error = new Error("SCHOOL_LOGIN_COUNTRY_REQUIRED");
    error.code = "SCHOOL_LOGIN_COUNTRY_REQUIRED";
    throw error;
  }
  const initials = schoolShortCodeFromName(schoolName);
  const yy = identityYearShort(year);
  const seq = padSchoolSequence(sequence);
  return `${iso}-${initials}-${yy}-${seq}`;
}

/**
 * @param {string} value
 * @param {{ forCreation?: boolean }} [options]
 */
function validateSchoolCode(value, options = {}) {
  const normalized = normalizeSchoolCode(value);
  if (!normalized) {
    const error = new Error("Code établissement requis.");
    error.code = "SCHOOL_CODE_REQUIRED";
    throw error;
  }
  if (isLegacySchoolCodeFormat(normalized)) {
    if (options.forCreation) {
      const error = new Error(
        "Format établissement legacy interdit pour une création (ex. CD-2026-0001). Utiliser le code V2 généré par PostgreSQL.",
      );
      error.code = "SCHOOL_CODE_LEGACY_FORBIDDEN";
      error.statusCode = 400;
      throw error;
    }
    return { normalized, kind: "legacy-read" };
  }
  if (!isV2SchoolLoginCode(normalized)) {
    const error = new Error("Code établissement invalide.");
    error.code = "SCHOOL_CODE_INVALID";
    error.statusCode = 400;
    throw error;
  }
  return { normalized, kind: "v2" };
}

function publicSchoolCodeFromRecord(school = {}) {
  const login = normalizeSchoolCode(school.loginCode ?? school.login_code);
  if (isV2SchoolLoginCode(login)) return login;
  const publicId = normalizeSchoolCode(school.publicId);
  if (isV2SchoolLoginCode(publicId)) return publicId;
  const code = normalizeSchoolCode(school.code);
  if (isV2SchoolLoginCode(code)) return code;
  return login || publicId || code;
}

function schoolLookupKeys(school = {}) {
  return [
    school.loginCode,
    school.login_code,
    school.publicId,
    school.code,
    school.legacySchoolCode,
    school.school_code,
  ]
    .map((value) => normalizeSchoolCode(value))
    .filter(Boolean);
}

function matchesSchoolLookup(school, requestedCode) {
  const requested = normalizeSchoolCode(requestedCode);
  if (!requested) return false;
  return schoolLookupKeys(school).includes(requested);
}

module.exports = {
  V2_SCHOOL_LOGIN_PATTERN,
  LEGACY_SCHOOL_CODE_PATTERN,
  normalizeSchoolCode,
  isV2SchoolLoginCode,
  isLegacySchoolCodeFormat,
  padSchoolSequence,
  formatSchoolLoginCode,
  validateSchoolCode,
  publicSchoolCodeFromRecord,
  schoolLookupKeys,
  matchesSchoolLookup,
};
