"use strict";

/**
 * LOT 4 — Clôture reconstruction Finance.
 * Toute présence d'une clé Finance dans PUT /api/backoffice/state est rejetée
 * avant fusion, persistance ou effet secondaire (y compris [], {}, null, mixte).
 */

const LEGACY_FINANCE_STATE_WRITE_CODE = "LEGACY_FINANCE_STATE_WRITE_FORBIDDEN";
const LEGACY_FINANCE_STATE_WRITE_MESSAGE =
  "Les données Finance ne sont plus modifiables via /api/backoffice/state. Utilisez les APIs /api/payments et /api/finance/*.";

const FINANCE_STATE_KEYS = Object.freeze([
  "feeGrids",
  "feeTariffHistory",
  "paymentReminders",
  "paymentStatuses",
  "payments",
  "schoolFeeItems",
  "studentFees",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function listRejectedFinanceKeys(rawBody = {}) {
  if (!isPlainObject(rawBody)) return [];
  return FINANCE_STATE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(rawBody, key));
}

/**
 * @param {object} rawBody
 * @returns {{
 *   body: object,
 *   rejectLegacyFinanceWrite: boolean,
 *   rejectedKeys: string[],
 * }}
 */
function stripLegacyFinanceStateWrite(rawBody = {}) {
  const rejectedKeys = listRejectedFinanceKeys(rawBody);
  if (!rejectedKeys.length) {
    return { body: rawBody, rejectLegacyFinanceWrite: false, rejectedKeys: [] };
  }

  const body = { ...rawBody };
  for (const key of rejectedKeys) {
    delete body[key];
  }
  return { body, rejectLegacyFinanceWrite: true, rejectedKeys };
}

module.exports = {
  FINANCE_STATE_KEYS,
  LEGACY_FINANCE_STATE_WRITE_CODE,
  LEGACY_FINANCE_STATE_WRITE_MESSAGE,
  listRejectedFinanceKeys,
  stripLegacyFinanceStateWrite,
};
