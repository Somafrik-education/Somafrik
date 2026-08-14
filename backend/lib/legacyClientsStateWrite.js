"use strict";

/**
 * LOT 7 — Clôture reconstruction Clients / comptes.
 */

const LEGACY_CLIENTS_STATE_WRITE_CODE = "LEGACY_CLIENTS_STATE_WRITE_FORBIDDEN";
const LEGACY_CLIENTS_STATE_WRITE_MESSAGE =
  "Les données Clients ne sont plus modifiables via /api/backoffice/state. Utilisez les APIs /api/backoffice/users, /contacts, /relations, /messages et /announcements.";

const CLIENTS_STATE_KEYS = Object.freeze([
  "users",
  "contacts",
  "relations",
  "messages",
  "announcements",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function listRejectedClientsKeys(rawBody = {}) {
  if (!isPlainObject(rawBody)) return [];
  return CLIENTS_STATE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(rawBody, key));
}

function stripLegacyClientsStateWrite(rawBody = {}) {
  const rejectedKeys = listRejectedClientsKeys(rawBody);
  if (!rejectedKeys.length) {
    return { body: rawBody, rejectLegacyClientsWrite: false, rejectedKeys: [] };
  }

  const body = { ...rawBody };
  for (const key of rejectedKeys) {
    delete body[key];
  }
  return { body, rejectLegacyClientsWrite: true, rejectedKeys };
}

module.exports = {
  CLIENTS_STATE_KEYS,
  LEGACY_CLIENTS_STATE_WRITE_CODE,
  LEGACY_CLIENTS_STATE_WRITE_MESSAGE,
  listRejectedClientsKeys,
  stripLegacyClientsStateWrite,
};
