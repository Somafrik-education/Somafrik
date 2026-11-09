"use strict";

/**
 * MONO-FIX-A3 — validation stricte des statuts de présence.
 *
 * Catalogue métier EXISTANT (aucun nouveau statut) : Présent, Absent, Retard,
 * Justifié — libellés envoyés par le Web (PresencesPage) et le Mobile
 * (TeacherAttendanceScreen) — et leurs valeurs internes PostgreSQL
 * (attendance.status) : present, absent, late, excused. Les variantes
 * historiquement acceptées par PostgresRepository.toAttendanceStatus sont
 * conservées à l'identique (accents et casse ignorés).
 *
 * Avant correctif, toute autre valeur était convertie en silence en
 * « absent » (ou « present » selon le booléen present) et pouvait écraser
 * un appel existant. Désormais : 400 ATTENDANCE_STATUS_INVALID, sans écriture.
 */

const ATTENDANCE_STATUS_INVALID = "ATTENDANCE_STATUS_INVALID";

/** Valeur normalisée (sans accents, minuscules) → statut interne PostgreSQL. */
const ATTENDANCE_STATUS_ALIASES = Object.freeze({
  present: "present",
  "present.": "present",
  absent: "absent",
  absence: "absent",
  retard: "late",
  late: "late",
  // Justifié = absence justifiée (contrat D3.5b)
  justifie: "excused",
  justifiee: "excused",
  excused: "excused",
  excuse: "excused",
});

const ACCEPTED_LABELS = "Présent, Absent, Retard, Justifié";

function normalizeKey(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function invalidAttendanceStatusError(status, index) {
  const shown = status === undefined ? "absent" : JSON.stringify(status);
  const where = Number.isInteger(index) ? ` (élément ${index + 1})` : "";
  const error = new Error(`Statut de présence invalide${where} : ${shown}. Valeurs acceptées : ${ACCEPTED_LABELS}.`);
  error.statusCode = 400;
  error.code = ATTENDANCE_STATUS_INVALID;
  if (Number.isInteger(index)) error.details = { index };
  return error;
}

/**
 * Statut interne (present | absent | late | excused) ou erreur 400.
 *
 * - statut texte reconnu ⇒ sa valeur interne ;
 * - statut absent ou vide ⇒ uniquement si le booléen historique `present` est
 *   fourni (true ⇒ present, false ⇒ absent) ; sinon refus ;
 * - statut inconnu, ou d'un autre type qu'une chaîne ⇒ refus.
 */
function normalizeAttendanceStatus(status, present, index) {
  const missing = status === undefined || status === null || (typeof status === "string" && status.trim() === "");
  if (missing) {
    if (typeof present === "boolean") return present ? "present" : "absent";
    throw invalidAttendanceStatusError(status, index);
  }
  if (typeof status !== "string") throw invalidAttendanceStatusError(status, index);
  const internal = ATTENDANCE_STATUS_ALIASES[normalizeKey(status)];
  if (!internal) throw invalidAttendanceStatusError(status, index);
  return internal;
}

/** Valide TOUS les éléments d'un appel avant toute écriture (tout ou rien). */
function assertAttendanceItemsStatuses(items = []) {
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    normalizeAttendanceStatus(item?.status, item?.present, index);
  });
}

module.exports = {
  ATTENDANCE_STATUS_INVALID,
  ATTENDANCE_STATUS_ALIASES,
  normalizeAttendanceStatus,
  assertAttendanceItemsStatuses,
};
