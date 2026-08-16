"use strict";

/**
 * LOT 6 — Clôture reconstruction Plateforme.
 * Toute présence d'une clé Plateforme dans PUT /api/backoffice/state est rejetée
 * avant fusion, persistance ou effet secondaire (y compris [], {}, null, mixte).
 */

const LEGACY_PLATFORM_STATE_WRITE_CODE = "LEGACY_PLATFORM_STATE_WRITE_FORBIDDEN";
const LEGACY_PLATFORM_STATE_WRITE_MESSAGE =
  "Les données Plateforme ne sont plus modifiables via /api/backoffice/state. Utilisez les APIs /api/backoffice/countries, /subscriptions, /notifications, /rbac et /dashboard-chart-config.";

const PLATFORM_STATE_KEYS = Object.freeze([
  "countries",
  "subscriptions",
  "subscriptionOffers",
  "subscriptionPayments",
  "subscriptionInvoices",
  "subscriptionDiscounts",
  "subscriptionAuditLog",
  "notifications",
  "rolePermissions",
  "dashboardChartConfig",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function listRejectedPlatformKeys(rawBody = {}) {
  if (!isPlainObject(rawBody)) return [];
  return PLATFORM_STATE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(rawBody, key));
}

/**
 * @param {object} rawBody
 * @returns {{
 *   body: object,
 *   rejectLegacyPlatformWrite: boolean,
 *   rejectedKeys: string[],
 * }}
 */
function stripLegacyPlatformStateWrite(rawBody = {}) {
  const rejectedKeys = listRejectedPlatformKeys(rawBody);
  if (!rejectedKeys.length) {
    return { body: rawBody, rejectLegacyPlatformWrite: false, rejectedKeys: [] };
  }

  const body = { ...rawBody };
  for (const key of rejectedKeys) {
    delete body[key];
  }
  return { body, rejectLegacyPlatformWrite: true, rejectedKeys };
}

module.exports = {
  PLATFORM_STATE_KEYS,
  LEGACY_PLATFORM_STATE_WRITE_CODE,
  LEGACY_PLATFORM_STATE_WRITE_MESSAGE,
  listRejectedPlatformKeys,
  stripLegacyPlatformStateWrite,
};
