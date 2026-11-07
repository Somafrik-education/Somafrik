"use strict";

/**
 * NFC-PRES-LOCAL-PR1b — signature Ed25519 des packs d'appel hors ligne et liste de révocation.
 *
 * Contrat : docs/audits/NFC-PRES-LOCAL-PR0-architecture-offline-20261107.md (§4.1, §4.2, §4.3).
 * Procédures : docs/student-card/NFC-PRES-LOCAL-PR1b-cles-pack.md.
 *
 * Configuration (aucune valeur par défaut, aucune clé dans le dépôt) :
 *  - ROLL_CALL_PACK_SIGNING_KEY : SECRET. Clé privée Ed25519 active, PKCS#8 DER encodé en base64
 *    ou base64url (une ligne) ;
 *  - ROLL_CALL_PACK_MATCH_SECRET : SECRET. Secret dédié (≥ 32 caractères, distinct de JWT_SECRET)
 *    de dérivation des `matchKey` ;
 *  - ROLL_CALL_PACK_KEYRING : PUBLIC. JSON
 *    { "revocationSequence": <entier ≥ 0>, "keys": [{ "keyId", "publicKey" (32 octets base64url),
 *      "status": "active" | "standby" | "retired" | "revoked" }] }.
 *
 * Fail-closed : variable absente, JSON invalide, aucune ou plusieurs clés `active`, clé privée mal
 * formée ou non Ed25519, clé privée ne correspondant pas à la clé publique `active` → 503, aucun
 * pack signé ni émis. Les messages d'erreur ne contiennent jamais de matériel de clé.
 *
 * La liste de révocation est signée par la clé active et livrée avec chaque pack (pas de route
 * dédiée) : elle ne contient que des `keyId` et une séquence, aucune clé ni donnée d'établissement.
 */

const crypto = require("node:crypto");
const { createHttpError } = require("./classesManagement");
const { CONTRACT_VERSION, packSigningMessage, revocationsSigningMessage } = require("./rollCallOfflineProof");

const SIGNING_KEY_ENV = "ROLL_CALL_PACK_SIGNING_KEY";
const KEYRING_ENV = "ROLL_CALL_PACK_KEYRING";
const MATCH_SECRET_ENV = "ROLL_CALL_PACK_MATCH_SECRET";
const MIN_MATCH_SECRET_LENGTH = 32;
const KNOWN_WEAK_SECRETS = new Set([
  "change-this-long-random-secret-before-use",
  "somafrik-dev-secret-change-me",
  "GENERER-SECRET-JWT-32-CARACTERES-MINIMUM-ICI",
]);
const KEY_STATUSES = Object.freeze(["active", "standby", "retired", "revoked"]);
const KEY_ID = /^rc-pack-[a-z0-9][a-z0-9-]{0,47}$/;
const PUBLIC_KEY_B64URL = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE_B64URL = /^[A-Za-z0-9_-]{86}$/;
const BASE64_ANY = /^[A-Za-z0-9+/_-]+={0,2}$/;
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const MAX_KEYS = 16;

const PACK_SIGNER_ERROR = Object.freeze({
  UNAVAILABLE: "ROLL_CALL_PACK_SIGNING_UNAVAILABLE",
  MATCH_SECRET_UNAVAILABLE: "ROLL_CALL_PACK_MATCH_SECRET_UNAVAILABLE",
});

function unavailable(reason) {
  const error = createHttpError(503, "Pack hors ligne indisponible : configuration de signature invalide.", PACK_SIGNER_ERROR.UNAVAILABLE);
  // Raison technique non sensible, pour les journaux d'exploitation et les tests uniquement.
  Object.defineProperty(error, "reason", { value: reason, enumerable: false });
  return error;
}

function publicKeyFromRaw(raw) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: "der", type: "spki" });
}

function rawPublicKey(keyObject) {
  return keyObject.export({ format: "der", type: "spki" }).subarray(SPKI_ED25519_PREFIX.length);
}

/** Trousseau public : validation stricte, sans aucune tolérance. */
function parseKeyring(rawJson) {
  const text = String(rawJson ?? "").trim();
  if (!text) throw unavailable("keyring_missing");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unavailable("keyring_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw unavailable("keyring_shape");
  const sequence = parsed.revocationSequence;
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw unavailable("keyring_sequence");
  if (!Array.isArray(parsed.keys) || parsed.keys.length === 0 || parsed.keys.length > MAX_KEYS) throw unavailable("keyring_keys");
  const seen = new Set();
  const seenPublic = new Set();
  const keys = parsed.keys.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw unavailable("keyring_entry");
    const { keyId, publicKey, status } = entry;
    if (typeof keyId !== "string" || !KEY_ID.test(keyId) || seen.has(keyId)) throw unavailable("keyring_key_id");
    if (typeof publicKey !== "string" || !PUBLIC_KEY_B64URL.test(publicKey)) throw unavailable("keyring_public_key");
    const raw = Buffer.from(publicKey, "base64url");
    if (raw.length !== 32 || raw.toString("base64url") !== publicKey || seenPublic.has(publicKey)) {
      throw unavailable("keyring_public_key");
    }
    if (!KEY_STATUSES.includes(status)) throw unavailable("keyring_status");
    try {
      publicKeyFromRaw(raw);
    } catch {
      throw unavailable("keyring_public_key");
    }
    seen.add(keyId);
    seenPublic.add(publicKey);
    return Object.freeze({ keyId, publicKey, status });
  });
  const active = keys.filter((key) => key.status === "active");
  if (active.length !== 1) throw unavailable("keyring_active_count");
  const revokedKeyIds = keys.filter((key) => key.status === "revoked").map((key) => key.keyId).sort();
  // Une révocation incrémente toujours la séquence : une liste non vide exige une séquence ≥ 1.
  if (revokedKeyIds.length > 0 && sequence < 1) throw unavailable("keyring_sequence");
  return Object.freeze({ revocationSequence: sequence, keys: Object.freeze(keys), active: active[0], revokedKeyIds: Object.freeze(revokedKeyIds) });
}

function parsePrivateKey(rawValue) {
  const text = String(rawValue ?? "").trim();
  if (!text) throw unavailable("signing_key_missing");
  if (!BASE64_ANY.test(text)) throw unavailable("signing_key_encoding");
  const der = Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  let key;
  try {
    key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch {
    throw unavailable("signing_key_format");
  }
  if (key.asymmetricKeyType !== "ed25519") throw unavailable("signing_key_type");
  return key;
}

/**
 * Construit le signataire à partir de l'environnement. Toute anomalie lève une erreur 503 ;
 * aucun signataire partiel n'est jamais renvoyé.
 */
function createPackSigner(env = process.env) {
  const keyring = parseKeyring(env[KEYRING_ENV]);
  const privateKey = parsePrivateKey(env[SIGNING_KEY_ENV]);
  const derivedPublic = rawPublicKey(crypto.createPublicKey(privateKey)).toString("base64url");
  if (derivedPublic !== keyring.active.publicKey) throw unavailable("signing_key_mismatch");
  const keyId = keyring.active.keyId;

  function sign(message) {
    return crypto.sign(null, message, privateKey).toString("base64url");
  }

  return Object.freeze({
    keyId,
    revocationSequence: keyring.revocationSequence,
    revokedKeyIds: keyring.revokedKeyIds,
    /** Signature du pack sur les octets exacts de packSigningMessage(pack). */
    signPack(pack) {
      if (!pack || pack.keyId !== keyId) throw unavailable("pack_key_id");
      return { alg: "Ed25519", keyId, value: sign(packSigningMessage(pack)) };
    },
    /** Liste de révocation signée, livrée avec le pack. */
    signedRevocations(issuedAt) {
      const revocations = {
        contractVersion: CONTRACT_VERSION,
        sequence: keyring.revocationSequence,
        revokedKeyIds: [...keyring.revokedKeyIds],
        issuedAt,
      };
      return { list: revocations, signature: { alg: "Ed25519", keyId, value: sign(revocationsSigningMessage(revocations)) } };
    },
  });
}

/**
 * Signataire à jour de l'environnement, réévalué à CHAQUE appel.
 *
 * Le signataire construit est réutilisé tant que les deux variables gardent exactement la même
 * valeur ; toute modification de l'une d'elles produit un nouveau signataire, et une configuration
 * devenue invalide lève 503 (jamais de signataire périmé servi depuis le cache).
 *
 * Exploitation : sur Render, les variables d'environnement d'un processus ne changent pas pendant
 * sa vie ; une rotation n'est donc effective qu'après le redéploiement (redémarrage) de CHAQUE
 * instance. Aucune rotation « à chaud » n'est promise (docs/student-card/NFC-PRES-LOCAL-PR1b-cles-pack.md §4).
 */
let cachedSigner = null;
function packSignerFromEnv(env = process.env) {
  const signingKey = String(env[SIGNING_KEY_ENV] ?? "");
  const keyring = String(env[KEYRING_ENV] ?? "");
  if (cachedSigner && cachedSigner.signingKey === signingKey && cachedSigner.keyring === keyring) {
    return cachedSigner.signer;
  }
  cachedSigner = null;
  const signer = createPackSigner(env);
  cachedSigner = { signingKey, keyring, signer };
  return signer;
}

function resetPackSignerCacheForTests() {
  cachedSigner = null;
}

/**
 * Secret dédié de dérivation des `matchKey` (HKDF), distinct de JWT_SECRET et par environnement.
 * Fail-closed : absent, < 32 caractères, valeur d'exemple connue ou égal à JWT_SECRET → 503.
 */
function resolvePackMatchSecret(env = process.env) {
  const secret = String(env[MATCH_SECRET_ENV] ?? "").trim();
  const jwtSecret = String(env.JWT_SECRET ?? "").trim();
  if (secret.length < MIN_MATCH_SECRET_LENGTH || KNOWN_WEAK_SECRETS.has(secret) || (jwtSecret && secret === jwtSecret)) {
    throw createHttpError(
      503,
      "Pack hors ligne indisponible : secret de rapprochement non configuré.",
      PACK_SIGNER_ERROR.MATCH_SECRET_UNAVAILABLE,
    );
  }
  return secret;
}

/**
 * Vérification de référence (tests, outillage d'exploitation, oracle du Mobile en PR2) :
 * `keyId` inconnu, révoqué, statut inattendu, algorithme ou signature mal formés → false.
 */
function verifySignature({ message, signature, keyring }) {
  if (!signature || signature.alg !== "Ed25519" || typeof signature.value !== "string" || !SIGNATURE_B64URL.test(signature.value)) {
    return false;
  }
  const entry = (keyring?.keys ?? []).find((key) => key.keyId === signature.keyId);
  if (!entry || entry.status === "revoked" || (keyring.revokedKeyIds ?? []).includes(entry.keyId)) return false;
  const bytes = Buffer.from(signature.value, "base64url");
  if (bytes.length !== 64 || bytes.toString("base64url") !== signature.value) return false;
  try {
    return crypto.verify(null, message, publicKeyFromRaw(Buffer.from(entry.publicKey, "base64url")), bytes);
  } catch {
    return false;
  }
}

module.exports = {
  SIGNING_KEY_ENV,
  KEYRING_ENV,
  MATCH_SECRET_ENV,
  KEY_STATUSES,
  PACK_SIGNER_ERROR,
  parseKeyring,
  createPackSigner,
  packSignerFromEnv,
  resetPackSignerCacheForTests,
  resolvePackMatchSecret,
  verifySignature,
};
