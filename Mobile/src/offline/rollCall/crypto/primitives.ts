/**
 * NFC-PRES-LOCAL-PR2 — primitives cryptographiques Mobile de l'appel hors ligne.
 *
 * Miroir de backend/lib/rollCallOfflineProof.js (PR1a) et du message signé de PR1b, pour Hermes :
 *  - SHA-256, HMAC-SHA256 : @noble/hashes 2.0.1 (version figée, pure JS, sans dépendance) ;
 *  - Ed25519 (vérification seulement) : @noble/curves 2.0.1, mode RFC 8032 strict
 *    (`zip215: false`), même règle que la vérification OpenSSL du Backend ;
 *  - UTF-8 strict, LP et JCS : ../jcs.ts (implémentation unique, parité jcs.js) ;
 *  - base64url strict, hexadécimal : ./bytes.ts. Aucun `Buffer`, aucun `node:crypto`.
 *
 * Aucune clé privée dans l'application. Aucun message d'erreur ne contient une valeur de champ.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { canonicalContractJson, lp, utf8 } from "../jcs";
import { base64urlDecode, base64urlEncode, bytesToHex, concatBytes, constantTimeEqual } from "./bytes";

export { lp };

/** JSON canonique du contrat (validateur de types, JCS, plafond de 256 Kio). */
export function canonicalJson(value: unknown): string {
  return canonicalContractJson(value).text;
}

export const CONTRACT_VERSION = "rc-offline-1";
export const ROLL_CALL_MODE = "teacher";
export const MEDIA = ["nfc", "qr"] as const;
export type RollCallMedium = (typeof MEDIA)[number];

export const TAGS = Object.freeze({
  cardRef: "somafrik.rc-offline.cardref.v1",
  verifier: "somafrik.rc-offline.verifier.v1",
  proof: "somafrik.rc-offline.proof.v1",
  pack: "somafrik.rc-offline.pack.v1\n",
  revocations: "somafrik.rc-offline.revocations.v1\n",
});

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const PUBLIC_ID = /^[A-Za-z0-9_-]{22}$/;
const CARD_SECRET = /^[A-Za-z0-9_-]{43}$/;
const DIGEST_B64URL = /^[A-Za-z0-9_-]{43}$/;
const KEY_BYTES = 32;

export class RollCallFieldError extends TypeError {
  readonly code = "RC_OFFLINE_FIELD_INVALID";
  constructor(readonly field: string) {
    super(`Valeur invalide : ${field}.`);
  }
}

export function sha256(bytes: Uint8Array): Uint8Array {
  return nobleSha256(bytes);
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length === 0) throw new RollCallFieldError("K");
  return hmac(nobleSha256, key, message);
}

export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new RollCallFieldError(field);
  return value;
}

function assertPackId(value: unknown): string {
  if (value === "") return value;
  return assertUuid(value, "packId");
}

function assertPublicId(value: unknown): string {
  if (typeof value !== "string" || !PUBLIC_ID.test(value)) throw new RollCallFieldError("publicId");
  return value;
}

function assertKey(key: Uint8Array): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) throw new RollCallFieldError("K");
  return key;
}

export type CardScope = { schoolId: string; classId: string; packId: string; publicId: string };
export type ProofInput = CardScope & {
  contractVersion: string;
  actorUserId: string;
  date: string;
  mode: string;
  sessionId: string;
  scanId: string;
  medium: string;
};

function cardScopeFields(input: CardScope): string[] {
  return [
    assertUuid(input?.schoolId, "schoolId"),
    assertUuid(input?.classId, "classId"),
    assertPackId(input?.packId),
    assertPublicId(input?.publicId),
  ];
}

function proofFields(input: ProofInput): string[] {
  if (input?.contractVersion !== CONTRACT_VERSION) throw new RollCallFieldError("contractVersion");
  if (input?.mode !== ROLL_CALL_MODE) throw new RollCallFieldError("mode");
  if (!(MEDIA as readonly string[]).includes(input?.medium)) throw new RollCallFieldError("medium");
  if (!isRealDate(input.date)) throw new RollCallFieldError("date");
  return [
    TAGS.proof,
    input.contractVersion,
    assertUuid(input.schoolId, "schoolId"),
    assertUuid(input.actorUserId, "actorUserId"),
    assertUuid(input.classId, "classId"),
    input.date,
    input.mode,
    assertUuid(input.sessionId, "sessionId"),
    assertPackId(input.packId),
    assertUuid(input.scanId, "scanId"),
    assertPublicId(input.publicId),
    input.medium,
  ];
}

/** K = 32 octets de SHA-256(utf8(secret)) ; le secret lu sur la carte n'est jamais conservé. */
export function deriveCardKeyFromSecret(secret: string): Uint8Array {
  if (typeof secret !== "string" || !CARD_SECRET.test(secret)) throw new RollCallFieldError("secret");
  return sha256(utf8(secret));
}

export function computeCardRef(input: CardScope): string {
  return base64urlEncode(sha256(lp([TAGS.cardRef, ...cardScopeFields(input)])));
}

export function computeVerifier(key: Uint8Array, input: CardScope): string {
  return base64urlEncode(hmacSha256(assertKey(key), lp([TAGS.verifier, ...cardScopeFields(input)])));
}

export function computeProof(key: Uint8Array, input: ProofInput): string {
  return base64urlEncode(hmacSha256(assertKey(key), lp(proofFields(input))));
}

/** Égalité à durée constante de deux empreintes de 32 octets en base64url canonique. */
export function digestsEqual(expected: unknown, candidate: unknown): boolean {
  if (typeof expected !== "string" || typeof candidate !== "string") return false;
  if (!DIGEST_B64URL.test(expected) || !DIGEST_B64URL.test(candidate)) return false;
  try {
    const left = base64urlDecode(expected);
    const right = base64urlDecode(candidate);
    if (left.length !== KEY_BYTES || right.length !== KEY_BYTES) return false;
    return constantTimeEqual(left, right);
  } catch {
    return false;
  }
}

/** payloadDigest = hex(SHA-256(utf8(JCS(corps sans payloadDigest)))). */
export function computePayloadDigest(body: Record<string, unknown>): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RollCallFieldError("$");
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(body)) if (key !== "payloadDigest") rest[key] = body[key];
  return bytesToHex(sha256(utf8(canonicalJson(rest))));
}

/** Message signé du pack : utf8("somafrik.rc-offline.pack.v1\n") ‖ utf8(JCS(pack)). */
export function packSigningMessage(pack: unknown): Uint8Array {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new RollCallFieldError("$");
  return concatBytes(utf8(TAGS.pack), utf8(canonicalJson(pack)));
}

/** Message signé de la liste de révocation (PR1b) : même construction, étiquette dédiée. */
export function revocationsSigningMessage(revocations: unknown): Uint8Array {
  if (!revocations || typeof revocations !== "object" || Array.isArray(revocations)) throw new RollCallFieldError("$");
  return concatBytes(utf8(TAGS.revocations), utf8(canonicalJson(revocations)));
}

const SIGNATURE_B64URL = /^[A-Za-z0-9_-]{86}$/;
const PUBLIC_KEY_B64URL = /^[A-Za-z0-9_-]{43}$/;

/**
 * Vérification Ed25519 stricte (RFC 8032, encodages non canoniques refusés).
 * Toute entrée mal formée donne `false`, jamais une exception.
 */
export function verifyEd25519(signatureB64url: unknown, message: Uint8Array, publicKeyB64url: unknown): boolean {
  if (typeof signatureB64url !== "string" || !SIGNATURE_B64URL.test(signatureB64url)) return false;
  if (typeof publicKeyB64url !== "string" || !PUBLIC_KEY_B64URL.test(publicKeyB64url)) return false;
  try {
    const signature = base64urlDecode(signatureB64url);
    const publicKey = base64urlDecode(publicKeyB64url);
    if (signature.length !== 64 || publicKey.length !== 32) return false;
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}
