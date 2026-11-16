"use strict";

/**
 * BULLETIN-CLASSE-01 / L3 — identité de l'établissement pour l'en-tête des bulletins.
 *
 * - `currentIdentity` : nom, adresse, pays et logo ACTUELS (brouillons, aperçus, et valeurs
 *   figées au moment d'une publication) ; le logo est lu sur le stockage existant.
 * - `freezeLogo` : copie immuable des octets du logo, adressée par empreinte SHA-256
 *   (table report_card_official_assets, migration manuelle 20261106) ; ré-exécutable.
 * - `getLogo` : octets d'un logo figé (réimpression fidèle des bulletins publiés).
 */

const crypto = require("node:crypto");
const { readSchoolLogoFile } = require("../lib/schoolLogo");

const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function text(value) {
  return value == null ? "" : String(value).trim();
}

function unavailable(err) {
  if (err && err.code === "42P01") {
    const wrapped = new Error("OFFICIAL_ASSETS_UNAVAILABLE");
    wrapped.code = "OFFICIAL_ASSETS_UNAVAILABLE";
    return wrapped;
  }
  return err;
}

function createReportCardOfficialIdentityStore(db, { readLogo = readSchoolLogoFile } = {}) {
  const pool = db && db.pool ? db.pool : db;

  async function currentIdentity(schoolId) {
    const result = await pool.query(
      `SELECT s.id::text AS id, s.school_code, s.name, s.address, s.logo_url, s.profile_payload, c.name AS country
         FROM schools s LEFT JOIN countries c ON c.id = s.country_id
        WHERE s.id::text = $1`,
      [text(schoolId)]
    );
    const row = result.rows[0];
    if (!row) return null;
    const profile = row.profile_payload && typeof row.profile_payload === "object" ? row.profile_payload : {};
    let logo = null;
    try {
      const file = await readLogo({
        id: row.id,
        code: row.school_code,
        school_code: row.school_code,
        logoUrl: row.logo_url,
        logoSource: profile.logoSource,
        logoUploadedAt: profile.logoUploadedAt,
      });
      if (file && Buffer.isBuffer(file.bytes) && file.bytes.length && MEDIA_TYPES.has(file.mimeType)) {
        logo = {
          sha256: crypto.createHash("sha256").update(file.bytes).digest("hex"),
          media_type: file.mimeType,
          bytes: file.bytes,
        };
      }
    } catch {
      logo = null;
    }
    return {
      establishment_name: text(row.name) || null,
      establishment_address: text(row.address) || null,
      establishment_country: text(row.country) || null,
      logo,
    };
  }

  async function freezeLogo(schoolId, logo) {
    if (!logo || !Buffer.isBuffer(logo.bytes)) return null;
    try {
      await pool.query(
        `INSERT INTO report_card_official_assets (school_id, sha256, media_type, bytes, byte_size)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (school_id, sha256) DO NOTHING`,
        [text(schoolId), logo.sha256, logo.media_type, logo.bytes, logo.bytes.length]
      );
    } catch (err) {
      throw unavailable(err);
    }
    return logo.sha256;
  }

  async function getLogo(schoolId, sha256) {
    if (!/^[0-9a-f]{64}$/.test(text(sha256))) return null;
    try {
      const result = await pool.query(
        "SELECT media_type, bytes FROM report_card_official_assets WHERE school_id::text = $1 AND sha256 = $2",
        [text(schoolId), text(sha256)]
      );
      const row = result.rows[0];
      return row ? { media_type: row.media_type, bytes: row.bytes } : null;
    } catch (err) {
      throw unavailable(err);
    }
  }

  return { currentIdentity, freezeLogo, getLogo };
}

/** Forme publiée (jamais d'octets dans le contenu signé). */
function publicIdentity(identity) {
  if (!identity) return null;
  return {
    establishment_name: identity.establishment_name || null,
    establishment_address: identity.establishment_address || null,
    // Contrat des snapshots : aucune clé « country » / « school » dans un contenu signé.
    establishment_country: identity.establishment_country || null,
    logo_sha256: identity.logo ? identity.logo.sha256 : null,
    logo_media_type: identity.logo ? identity.logo.media_type : null,
  };
}

module.exports = { createReportCardOfficialIdentityStore, publicIdentity };
