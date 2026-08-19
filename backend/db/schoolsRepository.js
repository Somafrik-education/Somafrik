"use strict";

/**
 * Repository PostgreSQL dédié aux établissements.
 * Ne lit ni n'écrit backoffice_state JSON.
 */

const {
  COUNTRY_NOT_FOUND_CODE,
  COUNTRY_NOT_FOUND_MESSAGE,
  normalizeSchoolCode,
  normalizeCountryIso,
  toSchoolDbStatus,
  extractProfilePayload,
  mapEstablishmentRow,
} = require("../lib/schoolsManagement");
const {
  generateInternalSchoolAlias,
  isInternalSchoolAlias,
  isLegacySchoolCodeFormat,
  validateSchoolCode,
} = require("../lib/schoolCodeV2");

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
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

  async function getByCode(schoolCode) {
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

    getByCode,

    /**
     * Upsert canonique — source de vérité PostgreSQL.
     *
     * Lecture / résolution : `getByCode` accepte encore un identifiant public
     * (login_code V2 ou school_code legacy).
     * Écriture :
     *   - CREATE avec code legacy → interdit
     *   - UPDATE identifié par un code public (legacy ou V2) → converti
     *     immédiatement en UUID, puis UPDATE `WHERE id = $uuid`
     *   - `school_code` interne : existant conservé, sinon SCH-* ; jamais
     *     de nouvelle génération CC-YYYY-NNNN
     *
     * @param {object} record
     */
    async persist(record) {
      const requestedCode = normalizeSchoolCode(
        record?.code ?? record?.schoolCode ?? record?.legacySchoolCode,
      );
      const requestedId = String(record?.id ?? "").trim();
      if (requestedCode === "*") {
        throw createHttpError(400, "Code établissement invalide.", "SCHOOL_CODE_INVALID");
      }
      const name = String(record?.name ?? "").trim();
      if (!name) {
        throw createHttpError(400, "Nom d'établissement requis.", "SCHOOL_NAME_REQUIRED");
      }

      const country = await requireCountry(record ?? {});

      let existing = null;
      if (requestedId) {
        try {
          existing = await loadMappedById(requestedId);
        } catch {
          existing = null;
        }
      }
      if (!existing && requestedCode) {
        const lookedUp = await getByCode(requestedCode);
        if (lookedUp) {
          existing = lookedUp;
        }
      }
      if (!existing && requestedCode && isLegacySchoolCodeFormat(requestedCode)) {
        try {
          validateSchoolCode(requestedCode, { forCreation: true });
        } catch (error) {
          throw createHttpError(error.statusCode || 400, error.message, error.code);
        }
      }

      const code =
        existing?.legacySchoolCode ||
        existing?.code ||
        (isInternalSchoolAlias(requestedCode) ? requestedCode : generateInternalSchoolAlias());
      if (isLegacySchoolCodeFormat(code) && !existing) {
        try {
          validateSchoolCode(code, { forCreation: true });
        } catch (error) {
          throw createHttpError(error.statusCode || 400, error.message, error.code);
        }
      }
      if (!existing) {
        const { classifySchoolDuplicates, DUPLICATE_STRONG } = require("../lib/schoolModule");
        const sameCountryRows = await db.all(
          `SELECT s.*, c.name AS country_name, c.iso_code, c.currency AS country_currency
           FROM schools s
           JOIN countries c ON c.id = s.country_id
           WHERE s.country_id = $1
             AND s.deleted_at IS NULL`,
          [country.id],
        );
        const mapped = (sameCountryRows || []).map((row) => mapEstablishmentRow(row)).filter(Boolean);
        const strong = classifySchoolDuplicates(record, mapped).filter((match) => match.level === DUPLICATE_STRONG);
        if (strong.length) {
          throw createHttpError(
            409,
            "Établissement déjà existant dans ce pays (même nom et ville).",
            "SCHOOL_DUPLICATE_STRONG",
          );
        }
      }
      const profile = extractProfilePayload({ ...record, name });
      const dbStatus = toSchoolDbStatus(record?.status);
      const deletedAt =
        record?.deletedAt || record?.status === "Supprimé" ? record?.deletedAt || new Date().toISOString() : null;

      const writeParams = [
        country.id,
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
      ];

      if (existing?.id) {
        const updated = await db.one(
          `UPDATE schools SET
             country_id = $2,
             name = $3,
             logo_url = $4,
             address = $5,
             city = $6,
             phone = $7,
             email = $8,
             school_type = $9,
             status = $10,
             profile_payload = $11::jsonb,
             deleted_at = $12,
             updated_at = NOW()
           WHERE id = $1
           RETURNING id`,
          [existing.id, ...writeParams],
        );
        return loadMappedById(updated.id);
      }

      const inserted = await db.one(
        `INSERT INTO schools (
           country_id, school_code, name, logo_url, address, city, phone, email,
           school_type, status, profile_payload, deleted_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW(), NOW())
         RETURNING id`,
        [country.id, code, ...writeParams.slice(1)],
      );

      return loadMappedById(inserted.id);
    },
  };
}

module.exports = { createSchoolsRepository };
