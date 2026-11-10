"use strict";

/**
 * P0-WEB-01 — lectures SQL du contrôle d'abonnement, partagées avec l'état autoritatif.
 * Les mêmes requêtes alimentent `getDataset().platformSchools` et
 * `listPlatformProjection().subscriptions` : le contrôle ciblé lit exactement les mêmes lignes.
 */

const SCHOOLS_WITH_COUNTRY_SQL = `
        SELECT s.*, c.name AS country_name, c.iso_code, c.currency AS country_currency, c.phone_code
        FROM schools s
        JOIN countries c ON c.id = s.country_id
        ORDER BY s.created_at, s.school_code
      `;

const SUBSCRIPTIONS_WITH_SCHOOL_SQL = `
        SELECT sub.*, s.school_code, c.iso_code AS country_code, c.name AS country_name
        FROM subscriptions sub
        JOIN schools s ON s.id = sub.school_id
        JOIN countries c ON c.id = s.country_id
        ORDER BY sub.created_at
      `;

module.exports = { SCHOOLS_WITH_COUNTRY_SQL, SUBSCRIPTIONS_WITH_SCHOOL_SQL };
