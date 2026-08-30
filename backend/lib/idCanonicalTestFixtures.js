"use strict";

/**
 * Lot B — identités de test.
 *
 * leftover* = colonnes historiques encore stockées (jamais Auth, tenant, lookup).
 * *Login / *UserCode = identités publiques : JWT, login HTTP, teacherId API, schoolCode principal.
 *
 * Les fixtures PG isolées (schema.sql sans trigger) doivent INSERT login_code V2
 * puis relire la valeur persistée. Ne pas inventer un alias leftover pour « faire passer ».
 */

const LEFTOVER_SCHOOL = Object.freeze({
  CD: "CD-2026-0001",
  BI: "BI-2026-0001",
  BI2: "BI-2026-0002",
});

const SCHOOL_LOGIN = Object.freeze({
  CD: "CD-IN-26-001",
  BI: "BI-ESB-26-001",
  BI2: "BI-ESB-26-002",
});

function asSchoolLogin(row, fallback) {
  return String(row?.login_code ?? fallback ?? "")
    .trim()
    .toUpperCase();
}

async function insertCanonicalSchool(pool, { countryId, leftoverCode, loginCode, name, profilePayload }) {
  const row = profilePayload
    ? await pool.query(
        `INSERT INTO schools (country_id, school_code, login_code, name, status, profile_payload)
         VALUES ($1, $2, $3, $4, 'active', $5::jsonb) RETURNING id, login_code, school_code`,
        [countryId, leftoverCode, loginCode, name, profilePayload],
      )
    : await pool.query(
        `INSERT INTO schools (country_id, school_code, login_code, name, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id, login_code, school_code`,
        [countryId, leftoverCode, loginCode, name],
      );
  return {
    id: row.rows[0].id,
    loginCode: asSchoolLogin(row.rows[0], loginCode),
    leftoverCode: String(row.rows[0].school_code ?? leftoverCode)
      .trim()
      .toUpperCase(),
  };
}

async function readSchoolLogin(pool, schoolId) {
  const row = await pool.query(`SELECT login_code FROM schools WHERE id = $1`, [schoolId]);
  return asSchoolLogin(row.rows[0], "");
}

module.exports = {
  LEFTOVER_SCHOOL,
  SCHOOL_LOGIN,
  asSchoolLogin,
  insertCanonicalSchool,
  readSchoolLogin,
};
