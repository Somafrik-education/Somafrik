"use strict";

/**
 * Repository PostgreSQL dédié aux établissements.
 * Ne lit ni n'écrit backoffice_state JSON.
 */

const { randomUUID } = require("node:crypto");
const {
  COUNTRY_NOT_FOUND_CODE,
  COUNTRY_NOT_FOUND_MESSAGE,
  normalizeSchoolCode,
  normalizeCountryIso,
  toSchoolDbStatus,
  extractProfilePayload,
  mapEstablishmentRow,
} = require("../lib/schoolsManagement");

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function generateInternalSchoolAlias() {
  return `SCH-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
}

/**
 * @param {{
 *   one: (sql: string, params?: unknown[]) => Promise<any>,
 *   all: (sql: string, params?: unknown[]) => Promise<any[]>,
 *   query: (sql: string, params?: unknown[]) => Promise<any>,
 * }} db
 */
function createSchoolsRepository(db) {
  async function requireCountry(record) {
    const isoCode = normalizeCountryIso(record.countryCode, record.country);
    const countryName = String(record.country ?? "").trim();
    let country = null;
    if (isoCode) {
      country = await db.one(
        "SELECT id, name, iso_code, currency FROM countries WHERE iso_code = $1 LIMIT 1",
        [isoCode],
      );
    }
    if (!country && countryName) {
      country = await db.one(
        "SELECT id, name, iso_code, currency FROM countries WHERE lower(name) = lower($1) LIMIT 1",
        [countryName],
      );
    }
    if (!country) {
      throw createHttpError(400, COUNTRY_NOT_FOUND_MESSAGE, COUNTRY_NOT_FOUND_CODE);
    }
    return country;
  }

  async function loadMappedById(id) {
    const row = await db.one(
      `SELECT s.*, c.name AS country_name, c.iso_code, c.currency AS country_currency
       FROM schools s
       JOIN countries c ON c.id = s.country_id
       WHERE s.id = $1`,
      [id],
    );
    return mapEstablishmentRow(row);
  }

  return {
    async listAll() {
      const rows = await db.all(
        `SELECT s.*, c.name AS country_name, c.iso_code, c.currency AS country_currency
         FROM schools s
         JOIN countries c ON c.id = s.country_id
         ORDER BY s.created_at ASC, s.school_code ASC`,
      );
      return rows.map((row) => mapEstablishmentRow(row));
    },

    async getByCode(schoolCode) {
      const code = normalizeSchoolCode(schoolCode);
      if (!code) return null;
      const row = await db.one(
        `SELECT s.*, c.name AS country_name, c.iso_code, c.currency AS country_currency
         FROM schools s
         JOIN countries c ON c.id = s.country_id
         WHERE upper(s.school_code) = $1
            OR upper(coalesce(s.login_code, '')) = $1
         LIMIT 1`,
        [code],
      );
      return mapEstablishmentRow(row);
    },

    /**
     * Upsert canonique — source de vérité PostgreSQL.
     * `school_code` reste un alias interne de compatibilité. Pour une création,
     * le client n'a plus à le fournir : `login_code` est généré par le trigger PG.
     * @param {object} record
     */
    async persist(record) {
      const requestedCode = normalizeSchoolCode(
        record?.code ?? record?.schoolCode ?? record?.legacySchoolCode,
      );
      if (requestedCode === "*") {
        throw createHttpError(400, "Code établissement invalide.", "SCHOOL_CODE_INVALID");
      }
      const code = requestedCode || generateInternalSchoolAlias();
      const name = String(record?.name ?? "").trim();
      if (!name) {
        throw createHttpError(400, "Nom d'établissement requis.", "SCHOOL_NAME_REQUIRED");
      }

      const country = await requireCountry(record ?? {});
      const profile = extractProfilePayload({ ...record, name });
      const dbStatus = toSchoolDbStatus(record?.status);
      const deletedAt =
        record?.deletedAt || record?.status === "Supprimé" ? record?.deletedAt || new Date().toISOString() : null;

      const inserted = await db.one(
        `INSERT INTO schools (
           country_id, school_code, name, logo_url, address, city, phone, email,
           school_type, status, profile_payload, deleted_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW(), NOW())
         ON CONFLICT (school_code) DO UPDATE SET
           country_id = EXCLUDED.country_id,
           name = EXCLUDED.name,
           logo_url = EXCLUDED.logo_url,
           address = EXCLUDED.address,
           city = EXCLUDED.city,
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           school_type = EXCLUDED.school_type,
           status = EXCLUDED.status,
           profile_payload = EXCLUDED.profile_payload,
           deleted_at = EXCLUDED.deleted_at,
           updated_at = NOW()
         RETURNING id`,
        [
          country.id,
          code,
          name,
          record?.logoUrl ?? "",
          record?.address ?? "",
          record?.city ?? "",
          record?.phone ?? "",
          record?.email ?? "",
          record?.type ?? "Établissement",
          dbStatus,
          JSON.stringify(profile),
          deletedAt,
        ],
      );

      return loadMappedById(inserted.id);
    },
  };
}

module.exports = { createSchoolsRepository };
