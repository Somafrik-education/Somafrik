"use strict";

/**
 * LOT 8 — Suppression définitive de PUT et GET /api/backoffice/state.
 * PostgreSQL = unique source de vérité ; APIs métier dédiées par domaine.
 */

const BACKOFFICE_STATE_WRITE_REMOVED_CODE = "BACKOFFICE_STATE_WRITE_REMOVED";
const BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE =
  "L'écriture globale BackOffice State a été supprimée. Utilisez les APIs métier dédiées.";

const BACKOFFICE_STATE_READ_REMOVED_CODE = "BACKOFFICE_STATE_READ_REMOVED";
const BACKOFFICE_STATE_READ_REMOVED_MESSAGE =
  "La lecture globale BackOffice State a été supprimée. Utilisez les APIs métier dédiées.";

const BACKOFFICE_STATE_WRITE_REMOVED_STATUS = 410;
const BACKOFFICE_STATE_READ_REMOVED_STATUS = 410;

function createBackOfficeStateWriteRemovedError() {
  const error = new Error(BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE);
  error.statusCode = BACKOFFICE_STATE_WRITE_REMOVED_STATUS;
  error.code = BACKOFFICE_STATE_WRITE_REMOVED_CODE;
  return error;
}

function createBackOfficeStateReadRemovedError() {
  const error = new Error(BACKOFFICE_STATE_READ_REMOVED_MESSAGE);
  error.statusCode = BACKOFFICE_STATE_READ_REMOVED_STATUS;
  error.code = BACKOFFICE_STATE_READ_REMOVED_CODE;
  return error;
}

function sendBackOfficeStateReadRemoved(res) {
  res.status(BACKOFFICE_STATE_READ_REMOVED_STATUS).json({
    code: BACKOFFICE_STATE_READ_REMOVED_CODE,
    message: BACKOFFICE_STATE_READ_REMOVED_MESSAGE,
  });
}

function sendBackOfficeStateWriteRemoved(res) {
  res.status(BACKOFFICE_STATE_WRITE_REMOVED_STATUS).json({
    code: BACKOFFICE_STATE_WRITE_REMOVED_CODE,
    message: BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  });
}

module.exports = {
  BACKOFFICE_STATE_WRITE_REMOVED_CODE,
  BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
  BACKOFFICE_STATE_READ_REMOVED_CODE,
  BACKOFFICE_STATE_READ_REMOVED_MESSAGE,
  BACKOFFICE_STATE_READ_REMOVED_STATUS,
  createBackOfficeStateWriteRemovedError,
  createBackOfficeStateReadRemovedError,
  sendBackOfficeStateReadRemoved,
  sendBackOfficeStateWriteRemoved,
};
