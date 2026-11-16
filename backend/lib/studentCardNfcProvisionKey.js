"use strict";

/**
 * CARTE-FIX-QR-NFC — clé et défis du provisionnement NFC (indépendants de l'authentification).
 *
 * Clé : STUDENT_CARD_NFC_PROVISION_SECRET (dédiée, recommandée) ; à défaut, clé DÉRIVÉE
 * (HMAC à étiquette de domaine) de JWT_SECRET, secret HS256 du Backend dont le démarrage en
 * production est déjà bloqué s'il est absent, faible ou court (assertProductionSecrets).
 * Fail-closed : secret absent, < 32 caractères, valeur d'exemple connue, ou clé dédiée égale à
 * JWT_SECRET → provisionnement indisponible (503), aucune opération tentée.
 * Rotation : les défis vivent 10 min et rien n'est persisté ; changer l'un ou l'autre secret
 * n'invalide que les encodages en cours, qui sont simplement recommencés.
 */
const crypto = require("node:crypto");
const { createHttpError } = require("./classesManagement");

const PROVISION_KEY_ENV = "STUDENT_CARD_NFC_PROVISION_SECRET";
const MIN_SECRET_LENGTH = 32;
const PROVISION_TTL_MS = 10 * 60 * 1000;
const KNOWN_WEAK_SECRETS = new Set([
  "change-this-long-random-secret-before-use",
  "somafrik-dev-secret-change-me",
]);
const DOMAIN_LABEL = "somafrik:student-card:nfc-provision:v1";
const CHALLENGE_RE = /^(\d{13})\.([A-Za-z0-9_-]{43})$/;

function unavailable() {
  return createHttpError(503, "Provisionnement NFC indisponible : configuration serveur invalide.", "STUDENT_CARD_NFC_PROVISION_UNAVAILABLE");
}

function strongSecret(value) {
  return value.length >= MIN_SECRET_LENGTH && !KNOWN_WEAK_SECRETS.has(value);
}

/** Résout la clé de signature des défis ; source = "dedicated" | "derived". */
function resolveNfcProvisionKey(env = process.env) {
  const jwtSecret = String(env.JWT_SECRET ?? "").trim();
  const dedicated = String(env[PROVISION_KEY_ENV] ?? "").trim();
  if (dedicated) {
    // Une clé dédiée invalide ne retombe jamais sur JWT_SECRET.
    if (!strongSecret(dedicated) || dedicated === jwtSecret) throw unavailable();
    return { key: crypto.createHmac("sha256", dedicated).update(DOMAIN_LABEL).digest(), source: "dedicated" };
  }
  if (!strongSecret(jwtSecret)) throw unavailable();
  return { key: crypto.createHmac("sha256", jwtSecret).update(DOMAIN_LABEL).digest(), source: "derived" };
}

function mac(fields, expiresAt, key) {
  return crypto.createHmac("sha256", key)
    .update([fields.cardId, fields.tokenHash, fields.uid, fields.tagType, fields.operationId, fields.actorId, String(expiresAt)].join("|"))
    .digest("base64url");
}

/** Défi lié à la carte, son empreinte, la puce, l'opération et l'acteur. */
function signProvisionChallenge(fields, expiresAt, key) {
  return `${expiresAt}.${mac(fields, expiresAt, key)}`;
}

/** Vrai seulement pour un défi intact, non expiré et émis pour exactement ces paramètres. */
function verifyProvisionChallenge(value, fields, key, nowMs) {
  const match = CHALLENGE_RE.exec(typeof value === "string" ? value : "");
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowMs || expiresAt > nowMs + PROVISION_TTL_MS) return false;
  const expected = Buffer.from(mac(fields, expiresAt, key));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = {
  PROVISION_KEY_ENV,
  PROVISION_TTL_MS,
  resolveNfcProvisionKey,
  signProvisionChallenge,
  verifyProvisionChallenge,
};
