"use strict";

/**
 * R3-3 — Indicative recovery classification only. A true value does NOT
 * authorize UID release, reassignment, a chip write, or an R2 recovery.
 * R3-4 remains blocked pending physical inventory and dual approval.
 */
function nfcRecoverable(card) {
  return card?.status === "revoked"
    && ["nfc_reservation_expired", "nfc_cancelled"].includes(card.revoke_reason)
    && card.nfc_uid != null
    && card.nfc_encoding_state === "pending"
    && card.nfc_encoded_at == null
    && card.nfc_locked_at == null
    && card.nfc_replaces_card_id == null;
}

module.exports = { nfcRecoverable };
