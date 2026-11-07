"use strict";

/**
 * NFC-PRES-LOCAL-PR1a — primitives cryptographiques pures de l'appel hors ligne.
 *
 * Contrat : docs/audits/NFC-PRES-LOCAL-PR0-architecture-offline-20261107.md (PR #1111, §3, §4.1, §9).
 * Aucune route, aucune base, aucun état : uniquement des calculs déterministes et leurs contrôles.
 *
 *  - LP : encodage canonique à longueurs préfixées (uint32 big-endian + octets UTF-8 par champ) ;
 *  - K : 32 octets de SHA-256(utf8(secret)), égal à hex_decode(student_access_cards.token_hash) ;
 *  - cardRef, verifier, proof : SHA-256 / HMAC-SHA256 sur LP(étiquette de domaine, champs) ;
 *  - JSON canonique (RFC 8785) via contracts/reportCard/jcs.js, implémentation de référence unique
 *    (PR0 révision 5), précédé d'un validateur de types du contrat (entiers sûrs uniquement, pas de
 *    -0 ni de flottant, profondeur ≤ 32) et suivi d'un plafond de 256 Kio ;
 *  - payloadDigest du lot et message signé du pack.
 *
 * Aucun message d'erreur ne contient la valeur d'un champ (secret, clé, preuve, identifiant).
 */

const crypto = require("node:crypto");
const { canonicalize } = require("../contracts/reportCard/jcs");

const CONTRACT_VERSION = "rc-offline-1";
const ROLL_CALL_MODE = "teacher";
const MEDIA = Object.freeze(["nfc", "qr"]);

const TAGS = Object.freeze({
  cardRef: "somafrik.rc-offline.cardref.v1",
  verifier: "somafrik.rc-offline.verifier.v1",
  proof: "somafrik.rc-offline.proof.v1",
  pack: "somafrik.rc-offline.pack.v1\n",
});

const OFFLINE_PROOF_ERROR = Object.freeze({
  FIELD_INVALID: "ROLL_CALL_OFFLINE_FIELD_INVALID",
  VALUE_INVALID: "ROLL_CALL_OFFLINE_VALUE_INVALID",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
const CARD_SECRET = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH = /^[0-9a-f]{64}$/;
const DIGEST_B64URL = /^[A-Za-z0-9_-]{43}$/;
const KEY_BYTES = 32;
const MAX_FIELD_BYTES = 0xffffffff;
const MAX_CANONICAL_DEPTH = 32;
/** Plafond du JSON canonique (contrat : corps de synchronisation ≤ 256 Kio). */
const MAX_CANONICAL_BYTES = 256 * 1024;

function invalid(code, field) {
  const error = new TypeError(`Valeur invalide : ${field}.`);
  error.code = code;
  error.field = field;
  return error;
}

function fieldError(field) {
  return invalid(OFFLINE_PROOF_ERROR.FIELD_INVALID, field);
}

/**
 * Chaîne UTF-16 bien formée (aucun surrogate isolé). Sans ce contrôle, l'encodeur UTF-8 remplace
 * un surrogate isolé par U+FFFD : "\ud800" et "\ufffd" donneraient les mêmes octets LP.
 */
function isWellFormedUtf16(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** LP(f1, …, fn) : pour chaque champ, longueur UTF-8 sur 4 octets big-endian puis les octets. */
function lp(fields) {
  if (!Array.isArray(fields) || fields.length === 0) throw fieldError("LP");
  const chunks = [];
  for (const [index, field] of fields.entries()) {
    if (typeof field !== "string" || !isWellFormedUtf16(field)) throw fieldError(`LP[${index}]`);
    const bytes = Buffer.from(field, "utf8");
    if (bytes.length > MAX_FIELD_BYTES) throw fieldError(`LP[${index}]`);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(bytes.length, 0);
    chunks.push(header, bytes);
  }
  return Buffer.concat(chunks);
}

function assertUuid(value, field) {
  if (typeof value !== "string" || !UUID.test(value)) throw fieldError(field);
  return value;
}

function assertDate(value, field = "date") {
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw fieldError(field);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw fieldError(field);
  return value;
}

function assertPublicId(value) {
  if (typeof value !== "string" || !PUBLIC_ID.test(value)) throw fieldError("publicId");
  return value;
}

/** `packId` vide (longueur 0) en mode dégradé sans pack, sinon UUID. */
function assertPackId(value) {
  if (value === "") return value;
  return assertUuid(value, "packId");
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw fieldError("K");
  return key;
}

/** K à partir du secret lu sur la carte : 32 octets de SHA-256(utf8(secret)). */
function deriveCardKeyFromSecret(secret) {
  if (typeof secret !== "string" || !CARD_SECRET.test(secret)) throw fieldError("secret");
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

/** K côté serveur : décodage du `token_hash` stocké (64 caractères hexadécimaux minuscules). */
function cardKeyFromTokenHash(tokenHash) {
  if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash)) throw fieldError("token_hash");
  return Buffer.from(tokenHash, "hex");
}

function cardScopeFields(input) {
  return [
    assertUuid(input?.schoolId, "schoolId"),
    assertUuid(input?.classId, "classId"),
    assertPackId(input?.packId),
    assertPublicId(input?.publicId),
  ];
}

function proofFields(input) {
  if (input?.contractVersion !== CONTRACT_VERSION) throw fieldError("contractVersion");
  if (input?.mode !== ROLL_CALL_MODE) throw fieldError("mode");
  if (!MEDIA.includes(input?.medium)) throw fieldError("medium");
  return [
    TAGS.proof,
    input.contractVersion,
    assertUuid(input.schoolId, "schoolId"),
    assertUuid(input.actorUserId, "actorUserId"),
    assertUuid(input.classId, "classId"),
    assertDate(input.date),
    input.mode,
    assertUuid(input.sessionId, "sessionId"),
    assertPackId(input.packId),
    assertUuid(input.scanId, "scanId"),
    assertPublicId(input.publicId),
    input.medium,
  ];
}

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const hmac = (key, message) => crypto.createHmac("sha256", assertKey(key)).update(message).digest();

/** cardRef = base64url(SHA-256(LP(étiquette, schoolId, classId, packId, publicId))). */
function computeCardRef(input) {
  return b64url(crypto.createHash("sha256").update(lp([TAGS.cardRef, ...cardScopeFields(input)])).digest());
}

/** verifier = base64url(HMAC(K, LP(étiquette, schoolId, classId, packId, publicId))). */
function computeVerifier(key, input) {
  return b64url(hmac(key, lp([TAGS.verifier, ...cardScopeFields(input)])));
}

/** proof = base64url(HMAC(K, LP(étiquette, contractVersion, …, publicId, medium))). */
function computeProof(key, input) {
  return b64url(hmac(key, lp(proofFields(input))));
}

/**
 * Comparaison à temps constant de deux valeurs de 32 octets en base64url.
 * Une valeur mal formée donne `false` (jamais d'exception, jamais d'information sur la position).
 */
function digestsEqual(expected, candidate) {
  if (typeof expected !== "string" || typeof candidate !== "string") return false;
  if (!DIGEST_B64URL.test(expected) || !DIGEST_B64URL.test(candidate)) return false;
  const left = Buffer.from(expected, "base64url");
  const right = Buffer.from(candidate, "base64url");
  if (left.length !== KEY_BYTES || right.length !== KEY_BYTES) return false;
  // Rejette les encodages non canoniques (bits de remplissage non nuls) : une seule forme acceptée.
  if (left.toString("base64url") !== expected || right.toString("base64url") !== candidate) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Vérifie une preuve reçue. Champs invalides ou preuve mal formée → `false`. */
function verifyProof(key, input, proof) {
  let expected;
  try {
    expected = computeProof(key, input);
  } catch {
    return false;
  }
  return digestsEqual(expected, proof);
}

/**
 * Types admis par le contrat avant canonicalisation : chaînes, entiers sûrs (sans -0), booléens,
 * null, tableaux denses, objets simples. jcs.js refuse déjà undefined, non-finis, surrogates isolés,
 * tableaux creux et objets non simples ; ce validateur ajoute les règles propres au contrat.
 */
function assertContractValue(value, path = "$", depth = 0) {
  if (depth > MAX_CANONICAL_DEPTH) throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, path);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, path);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, `${path}[${index}]`);
      assertContractValue(value[index], `${path}[${index}]`, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if ((proto !== Object.prototype && proto !== null) || typeof value.toJSON === "function") {
      throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, path);
    }
    for (const key of Object.keys(value)) assertContractValue(value[key], `${path}.${key}`, depth + 1);
    return;
  }
  throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, path);
}

/** JSON canonique RFC 8785 d'une valeur du contrat (validateur, jcs.js, plafond de taille). */
function canonicalJson(value) {
  assertContractValue(value);
  let canonical;
  try {
    canonical = canonicalize(value);
  } catch {
    throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, "$");
  }
  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BYTES) throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, "$");
  return canonical;
}

/** payloadDigest = hex(SHA-256(JCS(corps sans payloadDigest))). */
function computePayloadDigest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, "$");
  const { payloadDigest: _ignored, ...rest } = body;
  return crypto.createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex");
}

/** Message signé du pack : utf8(étiquette) ‖ utf8(JCS(pack)). La signature relève de PR1b. */
function packSigningMessage(pack) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw invalid(OFFLINE_PROOF_ERROR.VALUE_INVALID, "$");
  return Buffer.concat([Buffer.from(TAGS.pack, "utf8"), Buffer.from(canonicalJson(pack), "utf8")]);
}

module.exports = {
  CONTRACT_VERSION,
  ROLL_CALL_MODE,
  MEDIA,
  TAGS,
  MAX_CANONICAL_DEPTH,
  MAX_CANONICAL_BYTES,
  OFFLINE_PROOF_ERROR,
  lp,
  deriveCardKeyFromSecret,
  cardKeyFromTokenHash,
  computeCardRef,
  computeVerifier,
  computeProof,
  verifyProof,
  digestsEqual,
  assertContractValue,
  canonicalJson,
  computePayloadDigest,
  packSigningMessage,
};
