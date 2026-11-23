"use strict";

/**
 * GO-PROD-G6-02 / #921 — verrou plateforme du NFC carte élève non homologué.
 *
 * En production (NODE_ENV=production), le NFC carte élève reste désactivé pour
 * TOUS les établissements tant que la plateforme ne pose pas explicitement
 * SOMAFRIK_STUDENT_CARD_NFC_ALLOWED=true. Cette clé doit rester absente en
 * production tant que #921 (encodage physique) n'est pas homologué.
 *
 * Hors production : aucun effet (tests, recette locale).
 * Confinement de release uniquement : aucune fonctionnalité NFC ajoutée.
 */

const { isProductionEnv } = require("./authTokenPolicy");

const STUDENT_CARD_NFC_NOT_HOMOLOGATED = "STUDENT_CARD_NFC_NOT_HOMOLOGATED";

function isStudentCardNfcPlatformAllowed(env = process.env) {
  if (!isProductionEnv(env)) return true;
  return String(env.SOMAFRIK_STUDENT_CARD_NFC_ALLOWED ?? "").trim().toLowerCase() === "true";
}

/** Lecture : neutralise `studentCardNfcEnabled` (y compris une valeur déjà `true` en base). */
function applyStudentCardNfcReleaseGate(flags, env = process.env) {
  if (!isStudentCardNfcPlatformAllowed(env)) flags.studentCardNfcEnabled = false;
  return flags;
}

/** Écriture : vrai si l'activation demandée doit être refusée (409). */
function isStudentCardNfcActivationBlocked(requestedValue, env = process.env) {
  return requestedValue === true && !isStudentCardNfcPlatformAllowed(env);
}

module.exports = {
  STUDENT_CARD_NFC_NOT_HOMOLOGATED,
  isStudentCardNfcPlatformAllowed,
  applyStudentCardNfcReleaseGate,
  isStudentCardNfcActivationBlocked,
};
