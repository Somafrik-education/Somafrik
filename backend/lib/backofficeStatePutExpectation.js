"use strict";

const assert = require("node:assert/strict");
const {
  BACKOFFICE_STATE_WRITE_REMOVED_CODE,
  BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE,
  BACKOFFICE_STATE_WRITE_REMOVED_STATUS,
} = require("./backofficeStateRemoval");

function assertBackOfficeStateWriteRemoved(response, context = "") {
  const suffix = context ? ` (${context})` : "";
  assert.equal(response.status, BACKOFFICE_STATE_WRITE_REMOVED_STATUS, `${suffix}: ${JSON.stringify(response.data)}`);
  assert.equal(response.data?.code, BACKOFFICE_STATE_WRITE_REMOVED_CODE, suffix);
  assert.equal(response.data?.message, BACKOFFICE_STATE_WRITE_REMOVED_MESSAGE, suffix);
}

module.exports = {
  assertBackOfficeStateWriteRemoved,
};
