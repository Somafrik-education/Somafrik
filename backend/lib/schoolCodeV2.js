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
 * Allocation SEQ3 : PostgreSQL (`somafrik_prepare_school_login_code`) en
 * production. `allocateNextSchoolLoginCode` n'existe que pour le fallback /
 * E2E in-memory et n'émet jamais CC-YYYY-NNNN.
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
  if (isLegacySchoolCodeFormat(normalized) || isInternalSchoolAlias(normalized)) {
    const error = new Error(
      "Ancien code établissement refusé. Utiliser le login_code V2 (ex. CD-IN-26-001).",
    );
    error.code = "SCHOOL_CODE_LEGACY_FORBIDDEN";
    error.statusCode = 400;
    throw error;
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

function schoolLoginCodeFromRecord(school = {}) {
  const login = normalizeSchoolCode(school.loginCode ?? school.login_code);
  return isV2SchoolLoginCode(login) ? login : "";
}

function schoolLookupKeys(school = {}) {
  const login = schoolLoginCodeFromRecord(school);
  return login ? [login] : [];
}

function matchesSchoolLookup(school, requestedCode) {
  const requested = normalizeSchoolCode(requestedCode);
  if (!requested || isLegacySchoolCodeFormat(requested) || isInternalSchoolAlias(requested)) {
    return false;
  }
  const login = schoolLoginCodeFromRecord(school);
  return Boolean(login) && login === requested;
}

function generateInternalSchoolAlias() {
  const { randomUUID } = require("node:crypto");
  return `SCH-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
}

function isInternalSchoolAlias(value) {
  return /^SCH-[A-Z0-9]+$/.test(normalizeSchoolCode(value));
}

/**
 * Prochain SEQ3 pour un pays / année civile, d'après les login_code déjà
 * présents en mémoire. Miroir du compteur PG `(country_id, creation_year)`.
 * Réservé au fallback / E2E in-memory — pas aux clients Web/Mobile.
 */
function nextLoginSequenceFromSchools(schools, countryIso, year) {
  const iso = normalizeSchoolCode(countryIso).slice(0, 2);
  const yy = identityYearShort(year);
  let max = 0;
  for (const school of schools ?? []) {
    const login = publicSchoolCodeFromRecord(school);
    if (!isV2SchoolLoginCode(login)) continue;
    const parts = login.split("-");
    if (parts.length < 4) continue;
    if (parts[0] !== iso) continue;
    if (parts[parts.length - 2] !== yy) continue;
    const seq = Number(parts[parts.length - 1]);
    if (Number.isInteger(seq) && seq > max) max = seq;
  }
  return max + 1;
}

/**
 * Alloue un login_code V2 en mémoire (E2E / fallback). Production = trigger PG.
 * N'émet jamais CC-YYYY-NNNN.
 */
function allocateNextSchoolLoginCode(
  schools,
  { countryIso, schoolName, year = new Date().getFullYear() } = {},
) {
  const sequence = nextLoginSequenceFromSchools(schools, countryIso, year);
  return formatSchoolLoginCode({ countryIso, schoolName, year, sequence });
}

module.exports = {
  V2_SCHOOL_LOGIN_PATTERN,
  LEGACY_SCHOOL_CODE_PATTERN,
  normalizeSchoolCode,
  isV2SchoolLoginCode,
  isLegacySchoolCodeFormat,
  isInternalSchoolAlias,
  padSchoolSequence,
  formatSchoolLoginCode,
  validateSchoolCode,
  publicSchoolCodeFromRecord,
  schoolLoginCodeFromRecord,
  schoolLookupKeys,
  matchesSchoolLookup,
  generateInternalSchoolAlias,
  nextLoginSequenceFromSchools,
  allocateNextSchoolLoginCode,
};
