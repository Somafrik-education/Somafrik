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

function normalizeCountryIso(countryCode, countryName) {
  const raw = asTrimmedString(countryCode || countryName).toUpperCase();
  if (!raw) return "CD";
  if (raw === "RDC" || raw === "CONGO" || raw.startsWith("RÉPUBLIQUE DÉMOCRATIQUE")) {
    return "CD";
  }
  return raw.slice(0, 2);
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
  const mapped = {
    ...profile,
    id: row.id,
    countryId: row.country_id,
    countryCode: profile.countryCode || row.iso_code,
    publicId: profile.publicId || row.school_code,
    code: row.school_code,
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
  PROFILE_KEYS,
  isPlainObject,
  asTrimmedString,
  normalizeSchoolCode,
  normalizeCountryIso,
  toSchoolDbStatus,
  fromSchoolDbStatus,
  formatTimestamp,
  extractProfilePayload,
  parseProfilePayload,
  mapEstablishmentRow,
};
