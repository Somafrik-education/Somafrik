"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  BACKOFFICE_STATE_WRITE_REMOVED_CODE,
  BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
  BACKOFFICE_STATE_READ_REMOVED_CODE,
  BACKOFFICE_STATE_READ_REMOVED_MESSAGE,
  BACKOFFICE_STATE_READ_REMOVED_STATUS,
  createBackOfficeStateWriteRemovedError,
  createBackOfficeStateReadRemovedError,
} = require("./backofficeStateRemoval");

test("createBackOfficeStateWriteRemovedError expose code et statut 410", () => {
  const error = createBackOfficeStateWriteRemovedError();
  assert.equal(error.code, BACKOFFICE_STATE_WRITE_REMOVED_CODE);
  assert.equal(error.statusCode, BACKOFFICE_STATE_WRITE_REMOVED_STATUS);
  assert.equal(error.message, BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE);
});

test("createBackOfficeStateReadRemovedError expose code et statut 410", () => {
  const error = createBackOfficeStateReadRemovedError();
  assert.equal(error.code, BACKOFFICE_STATE_READ_REMOVED_CODE);
  assert.equal(error.statusCode, BACKOFFICE_STATE_READ_REMOVED_STATUS);
  assert.equal(error.message, BACKOFFICE_STATE_READ_REMOVED_MESSAGE);
});

test("module exporte les constantes attendues", () => {
  assert.equal(BACKOFFICE_STATE_WRITE_REMOVED_CODE, "BACKOFFICE_STATE_WRITE_REMOVED");
  assert.equal(BACKOFFICE_STATE_READ_REMOVED_CODE, "BACKOFFICE_STATE_READ_REMOVED");
  assert.match(BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE, /APIs métier dédiées/);
  assert.match(BACKOFFICE_STATE_READ_REMOVED_MESSAGE, /APIs métier dédiées/);
});
