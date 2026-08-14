"use strict";

/**
 * LOT 8 — Suppression définitive de PUT /api/backoffice/state.
 * PostgreSQL = unique source de vérité ; GET state = projection read-only dépréciée.
 */

const BACKOFFICE_STATE_WRITE_REMOVED_CODE = "BACKOFFICE_STATE_WRITE_REMOVED";
const BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE =
  "L'écriture globale BackOffice State a été supprimée. Utilisez les APIs métier dédiées.";

const BACKOFFICE_STATE_WRITE_REMOVED_STATUS = 410;

function createBackOfficeStateWriteRemovedError() {
  const error = new Error(BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE);
  error.statusCode = BACKOFFICE_STATE_WRITE_REMOVED_STATUS;
  error.code = BACKOFFICE_STATE_WRITE_REMOVED_CODE;
  return error;
}

module.exports = {
  BACKOFFICE_STATE_WRITE_REMOVED_CODE,
  BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
  createBackOfficeStateWriteRemovedError,
};
