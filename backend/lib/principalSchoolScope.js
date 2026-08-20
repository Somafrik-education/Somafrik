"use strict";

const { BusinessError } = require("../services/authService");
const { getCountryCodeFromScope, schoolMatchesCountryScope } = require("./countryScope");
const {
  isInternalSchoolAlias,
  isV2SchoolLoginCode,
  matchesSchoolLookup,
  normalizeSchoolCode,
  publicSchoolCodeFromRecord,
} = require("./schoolCodeV2");

const SCHOOL_SCOPE_HEADER = "X-Somafrik-School-Code";
const SUPER_ADMIN_ROLES = new Set([
  "Super Administrateur Somafrik",
  "Super Administrateur OKAFRIK",
]);

function resolvePrincipalSchoolCode(principal) {
  const schoolCode = String(principal?.schoolCode ?? "").trim().toUpperCase();
  if (!schoolCode || schoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }
  return schoolCode;
}

function stripClientSchoolCode(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const { schoolCode: _ignored, ...rest } = payload;
  return rest;
}

function scopeResidualItems(schoolCode, items = []) {
  const scopedSchoolCode = String(schoolCode ?? "")
    .trim()
    .toUpperCase();
  if (!scopedSchoolCode || scopedSchoolCode === "*") {
    throw new BusinessError(400, "schoolCode établissement requis.");
  }

  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    const itemSchoolCode = String(item?.schoolCode ?? "")
      .trim()
      .toUpperCase();
    if (itemSchoolCode && itemSchoolCode !== scopedSchoolCode) {
      throw new BusinessError(
        400,
        `Élément hors périmètre établissement (${itemSchoolCode} ≠ ${scopedSchoolCode}).`,
      );
    }
  }

  return list.map((item) => ({
    ...(item && typeof item === "object" ? item : {}),
    schoolCode: scopedSchoolCode,
  }));
}

function scopeError(statusCode, message, code) {
  const error = new BusinessError(statusCode, message);
  error.code = code;
  return error;
}

function isSuperAdminPrincipal(principal) {
  return SUPER_ADMIN_ROLES.has(String(principal?.role ?? "").trim());
}

function isCountryAdminPrincipal(principal) {
  return String(principal?.role ?? "").trim() === "Admin Pays";
}

function isPlatformSchoolScope(principal) {
  const schoolCode = normalizeSchoolCode(principal?.schoolCode);
  return !schoolCode || schoolCode === "*";
}

function canonicalSchoolCodeFromRecord(school) {
  const publicCode = publicSchoolCodeFromRecord(school);
  if (publicCode) return publicCode;
  return normalizeSchoolCode(
    school?.school_code ?? school?.schoolCode ?? school?.code ?? school?.legacySchoolCode,
  );
}

function schoolRecordForCountryMatch(school = {}) {
  const publicCode = canonicalSchoolCodeFromRecord(school);
  return {
    ...school,
    countryCode:
      school.countryCode || school.country_code || school.iso_code || school.isoCode,
    country: school.country || school.country_name,
    code: publicCode || school.code || school.school_code,
    loginCode: school.loginCode || school.login_code,
  };
}

function schoolBelongsToCountry(school, principal) {
  const countryScope = principal?.countryCode || principal?.countryScope || "";
  if (!countryScope) return false;
  const record = schoolRecordForCountryMatch(school);
  if (schoolMatchesCountryScope(record, countryScope)) return true;
  const principalIso = getCountryCodeFromScope(countryScope);
  const schoolIso =
    getCountryCodeFromScope(record.countryCode) ||
    (isV2SchoolLoginCode(canonicalSchoolCodeFromRecord(record))
      ? canonicalSchoolCodeFromRecord(record).slice(0, 2)
      : "");
  return Boolean(principalIso && schoolIso && principalIso === schoolIso);
}

function schoolMatchesPrincipalJwt(school, jwtSchoolCode) {
  const jwt = normalizeSchoolCode(jwtSchoolCode);
  if (!jwt || jwt === "*") return false;
  if (matchesSchoolLookup(school, jwt)) return true;
  return canonicalSchoolCodeFromRecord(school) === jwt;
}

function readRequestedSchoolCode(req) {
  if (!req) return "";
  const fromGetter =
    typeof req.get === "function" ? req.get(SCHOOL_SCOPE_HEADER) ?? req.get("x-somafrik-school-code") : "";
  const rawHeader = req.headers?.["x-somafrik-school-code"];
  const fromHeaders = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return normalizeSchoolCode(fromGetter || fromHeaders || "");
}

/**
 * Scope établissement request-scoped, vérifié serveur.
 * Le header client n'est jamais une autorité : Superadmin / Admin Pays uniquement,
 * après lookup PostgreSQL. Admin School ne peut pas override son JWT.
 */
function resolveEffectiveSchoolScope({ principal, requestedSchoolCode, school } = {}) {
  const requested = normalizeSchoolCode(requestedSchoolCode);
  const jwtSchool = normalizeSchoolCode(principal?.schoolCode);

  if (requested === "*") {
    throw scopeError(400, "schoolCode établissement requis.", "SCHOOL_SCOPE_REQUIRED");
  }
  if (requested && isInternalSchoolAlias(requested)) {
    throw scopeError(
      400,
      "Identité établissement interne interdite. Utiliser le login_code V2.",
      "SCHOOL_SCOPE_INTERNAL_ALIAS_FORBIDDEN",
    );
  }

  if (!isPlatformSchoolScope(principal)) {
    if (!requested) {
      return { ...principal };
    }
    if (!school || !schoolMatchesPrincipalJwt(school, jwtSchool)) {
      throw scopeError(
        403,
        "Accès refusé: établissement hors périmètre.",
        "SCHOOL_SCOPE_OVERRIDE_FORBIDDEN",
      );
    }
    const canonical = canonicalSchoolCodeFromRecord(school);
    return {
      ...principal,
      schoolCode: canonical || jwtSchool,
    };
  }

  if (!requested) {
    return { ...principal };
  }
  if (!school) {
    throw scopeError(404, "Établissement introuvable.", "SCHOOL_SCOPE_NOT_FOUND");
  }

  if (isCountryAdminPrincipal(principal) && !schoolBelongsToCountry(school, principal)) {
    throw scopeError(403, "Accès refusé: pays hors périmètre.", "SCHOOL_SCOPE_COUNTRY_FORBIDDEN");
  }
  if (
    !isSuperAdminPrincipal(principal) &&
    !isCountryAdminPrincipal(principal) &&
    !schoolBelongsToCountry(school, principal)
  ) {
    throw scopeError(403, "Accès refusé: établissement hors périmètre.", "SCHOOL_SCOPE_FORBIDDEN");
  }

  const canonical = canonicalSchoolCodeFromRecord(school);
  if (!canonical) {
    throw scopeError(404, "Établissement introuvable.", "SCHOOL_SCOPE_NOT_FOUND");
  }
  return {
    ...principal,
    schoolCode: canonical,
  };
}

async function applyEffectiveSchoolScope(req, lookupSchool) {
  if (!req?.principal) return req?.principal ?? null;
  const requested = readRequestedSchoolCode(req);
  let school = null;
  if (requested && requested !== "*" && !isInternalSchoolAlias(requested) && typeof lookupSchool === "function") {
    school = await lookupSchool(requested);
  }
  req.principal = resolveEffectiveSchoolScope({
    principal: req.principal,
    requestedSchoolCode: requested,
    school,
  });
  return req.principal;
}

module.exports = {
  SCHOOL_SCOPE_HEADER,
  resolvePrincipalSchoolCode,
  stripClientSchoolCode,
  scopeResidualItems,
  resolveEffectiveSchoolScope,
  applyEffectiveSchoolScope,
  readRequestedSchoolCode,
  canonicalSchoolCodeFromRecord,
  isPlatformSchoolScope,
};
