"use strict";

/**
 * LOT 1 — Établissements canoniques PostgreSQL.
 * Mapping ligne PG ↔ enregistrement BackOffice, sans lecture/écriture du snapshot JSON.
 */

const PROFILE_KEYS = Object.freeze([
  "principalName",
  "principalEmail",
  "principalPhone",
  "validationStatus",
  "validationRequestedBy",
  "validationRequestedAt",
  "validatedBy",
  "validatedAt",
  "subscriptionPlan",
  "subscriptionStatus",
  "subscriptionStartDate",
  "subscriptionEndDate",
  "maxStudents",
  "maxTeachers",
  "currency",
  "website",
  "slogan",
  "timezone",
  "language",
  "dateFormat",
  "primaryColor",
  "schoolYear",
  "publicId",
  "deletedBy",
  "country",
  "countryCode",
  "type",
  "status",
  "createdAt",
  "updatedAt",
  "deletedAt",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value) {
  return String(value ?? "").trim();
}

function normalizeSchoolCode(value) {
  return asTrimmedString(value).toUpperCase();
}

const COUNTRY_NOT_FOUND_CODE = "COUNTRY_NOT_FOUND";
const COUNTRY_NOT_FOUND_MESSAGE =
  "Pays inconnu : utilisez un code présent dans le référentiel pays.";

function isRdcAlias(value) {
  const raw = asTrimmedString(value).toUpperCase();
  return (
    raw === "CD" ||
    raw === "RDC" ||
    raw === "CONGO" ||
    raw.startsWith("RÉPUBLIQUE DÉMOCRATIQUE") ||
    raw.startsWith("REPUBLIQUE DEMOCRATIQUE")
  );
}

function normalizeCountryIso(countryCode, countryName) {
  const rawCode = asTrimmedString(countryCode).toUpperCase();
  const rawName = asTrimmedString(countryName).toUpperCase();
  if (isRdcAlias(rawCode) || (!rawCode && isRdcAlias(rawName))) {
    return "CD";
  }
  if (rawCode) {
    return rawCode.slice(0, 8);
  }
  if (!rawName) {
    return "";
  }
  return rawName.slice(0, 2);
}

function countryCatalogCode(country) {
  return asTrimmedString(country?.code || country?.iso_code).toUpperCase();
}

function findCanonicalCountry(countries, countryCode, countryName) {
  const list = Array.isArray(countries) ? countries : [];
  const iso = normalizeCountryIso(countryCode, countryName);
  const name = asTrimmedString(countryName).toLowerCase();
  return (
    list.find((country) => {
      const code = countryCatalogCode(country);
      const id = asTrimmedString(country?.id).toUpperCase();
      const countryNameValue = asTrimmedString(country?.name).toLowerCase();
      if (iso && (code === iso || id === iso || (iso === "CD" && (code === "RDC" || id === "RDC" || id === "COUNTRY-RDC")))) {
        return true;
      }
      if (name && countryNameValue === name) {
        return true;
      }
      return false;
    }) || null
  );
}

function toSchoolDbStatus(status) {
  const value = asTrimmedString(status);
  if (value === "Suspendu") return "suspended";
  if (value === "Désactivé" || value === "Supprimé") return "inactive";
  if (value === "En attente" || value === "Brouillon") return "pending";
  if (value === "Archivé") return "archived";
  return "active";
}

function fromSchoolDbStatus(status) {
  if (status === "suspended") return "Suspendu";
  if (status === "inactive") return "Désactivé";
  if (status === "pending") return "En attente";
  if (status === "archived") return "Archivé";
  return "Actif";
}

function formatTimestamp(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function extractProfilePayload(record = {}) {
  const profile = {};
  for (const key of PROFILE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) {
      profile[key] = record[key];
    }
  }
  return profile;
}

function parseProfilePayload(raw) {
  if (isPlainObject(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Construit l'enregistrement BO à partir d'une ligne `schools` (+ pays / abonnement).
 */
function mapEstablishmentRow(row, subscription = null) {
  if (!row) return null;
  const profile = parseProfilePayload(row.profile_payload);
  const countryName =
    profile.country ||
    (row.country_name === "République Démocratique du Congo" ? "RDC" : row.country_name);
  const canonicalLoginCode = asTrimmedString(row.login_code).toUpperCase();
  const legacySchoolCode = asTrimmedString(row.school_code).toUpperCase();
  const mapped = {
    ...profile,
    id: row.id,
    countryId: row.country_id,
    countryCode: profile.countryCode || row.iso_code,
    publicId: profile.publicId || legacySchoolCode,
    code: legacySchoolCode,
    loginCode: canonicalLoginCode,
    shortCode: asTrimmedString(row.short_code).toUpperCase(),
    legacySchoolCode,
    name: row.name,
    type: row.school_type || profile.type || "Établissement",
    city: row.city || profile.city || "",
    country: countryName,
    address: row.address || profile.address || "",
    phone: row.phone || profile.phone || "",
    email: row.email || profile.email || "",
    website: profile.website ?? "",
    currency: profile.currency || row.country_currency,
    slogan: profile.slogan ?? "",
    status: profile.status || fromSchoolDbStatus(row.status),
    logoUrl: row.logo_url || profile.logoUrl || "",
    schoolYear: profile.schoolYear || "2025-2026",
    timezone: profile.timezone || "Africa/Kinshasa",
    language: profile.language || "Français",
    dateFormat: profile.dateFormat || "JJ-MM-AAAA",
    primaryColor: profile.primaryColor || "#2563EB",
    createdAt: profile.createdAt || formatTimestamp(row.created_at),
    updatedAt: profile.updatedAt || formatTimestamp(row.updated_at),
    deletedAt: formatTimestamp(row.deleted_at) || profile.deletedAt,
    deletedBy: profile.deletedBy,
  };

  if (subscription) {
    mapped.subscriptionPlan = mapped.subscriptionPlan || subscription.plan_name || "Essentiel";
    mapped.subscriptionStartDate =
      mapped.subscriptionStartDate || formatTimestamp(subscription.start_date);
    mapped.subscriptionEndDate = mapped.subscriptionEndDate || formatTimestamp(subscription.end_date);
    if (!mapped.subscriptionStatus && subscription.status) {
      if (subscription.status === "active") mapped.subscriptionStatus = "À jour";
      else if (subscription.status === "suspended") mapped.subscriptionStatus = "Suspendu";
      else if (subscription.status === "expired") mapped.subscriptionStatus = "En retard";
    }
  }

  return mapped;
}

module.exports = {
  COUNTRY_NOT_FOUND_CODE,
  COUNTRY_NOT_FOUND_MESSAGE,
  PROFILE_KEYS,
  isPlainObject,
  asTrimmedString,
  normalizeSchoolCode,
  normalizeCountryIso,
  findCanonicalCountry,
  toSchoolDbStatus,
  fromSchoolDbStatus,
  formatTimestamp,
  extractProfilePayload,
  parseProfilePayload,
  mapEstablishmentRow,
};
