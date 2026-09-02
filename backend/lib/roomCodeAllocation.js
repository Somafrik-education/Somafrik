"use strict";

/**
 * Codes salle canoniques : SAL-####, uniques par établissement.
 * Aucune convention SAL- n'existait dans le dépôt ; ne pas préfixer par schoolCode
 * (unicité déjà (school_id, room_code)).
 */

function formatRoomCode(sequence) {
  const n = Number(sequence);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("séquence salle invalide");
  }
  return `SAL-${String(n).padStart(4, "0")}`;
}

function extractRoomSequence(value) {
  const match = String(value ?? "").trim().match(/^SAL-(\d{4})$/i);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

module.exports = {
  formatRoomCode,
  extractRoomSequence,
};
