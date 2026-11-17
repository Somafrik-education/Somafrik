"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { nfcRecoverable } = require("./studentCardNfcPrevention");

function reservation(overrides = {}) {
  return { status: "revoked", revoke_reason: "nfc_cancelled", nfc_uid: "04AABBCCDDEE11",
    nfc_encoding_state: "pending", nfc_encoded_at: null, nfc_locked_at: null, ...overrides };
}

test("R3-3: only cancelled/expired pending NFC records are administratively eligible", () => {
  assert.equal(nfcRecoverable(reservation()), true);
  assert.equal(nfcRecoverable(reservation({ revoke_reason: "nfc_reservation_expired" })), true);
  for (const reason of ["revoked", "nfc_abandoned", "lost", "replaced", null]) {
    assert.equal(nfcRecoverable(reservation({ revoke_reason: reason })), false, reason);
  }
  for (const overrides of [
    { status: "active" }, { status: "issued" }, { nfc_uid: null },
    { nfc_encoding_state: "encoded" }, { nfc_encoding_state: "locked" },
    { nfc_encoded_at: new Date() }, { nfc_locked_at: new Date() },
    { nfc_replaces_card_id: "previous-card" },
  ]) assert.equal(nfcRecoverable(reservation(overrides)), false, JSON.stringify(overrides));
});
