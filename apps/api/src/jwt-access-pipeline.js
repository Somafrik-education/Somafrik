import { types } from "node:util";

import { decodeJwtCompactStrict } from "./jwt-compact-decoder.js";
import { isJwtClaimsPolicySatisfied } from "./jwt-claims-policy.js";
import { resolveJwtRs256VerificationKey } from "./jwt-kid-resolver.js";
import { verifyJwtRs256Signature } from "./jwt-rs256-verifier.js";

const DECODED_KEYS = [
  "protectedHeader",
  "payload",
  "signingInput",
  "signature",
];

/**
 * @param {object} object
 * @param {string} key
 * @returns {boolean}
 */
function isOwnDataProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return (
    descriptor !== undefined &&
    Object.hasOwn(descriptor, "value") &&
    !Object.hasOwn(descriptor, "get") &&
    !Object.hasOwn(descriptor, "set")
  );
}

/**
 * @param {object} object
 * @param {string} key
 * @returns {unknown}
 */
function ownDataValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor === undefined ? undefined : descriptor.value;
}

/**
 * Shape check for V2.1r decoded object fields (header/payload).
 * Does not re-decode JSON and does not re-apply claims policy.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isDecoderProducedObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (types.isProxy(value) || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }

  const names = Object.getOwnPropertyNames(value);
  for (let index = 0; index < names.length; index += 1) {
    if (!isOwnDataProperty(value, names[index])) {
      return false;
    }
  }

  return true;
}

/**
 * Exact V2.1r decoder success predicate — output contract only.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isExactDecodedJwt(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (types.isProxy(value) || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  if (Object.getOwnPropertySymbols(value).length !== 0) {
    return false;
  }

  const names = Object.getOwnPropertyNames(value);
  if (names.length !== DECODED_KEYS.length) {
    return false;
  }

  for (let index = 0; index < DECODED_KEYS.length; index += 1) {
    const key = DECODED_KEYS[index];
    if (!Object.hasOwn(value, key) || !isOwnDataProperty(value, key)) {
      return false;
    }
  }

  const protectedHeader = ownDataValue(value, "protectedHeader");
  const payload = ownDataValue(value, "payload");
  const signingInput = ownDataValue(value, "signingInput");
  const signature = ownDataValue(value, "signature");

  if (!isDecoderProducedObject(protectedHeader)) {
    return false;
  }
  if (!isDecoderProducedObject(payload)) {
    return false;
  }
  if (typeof signingInput !== "string") {
    return false;
  }
  if (
    !(signature instanceof Uint8Array) ||
    signature.constructor !== Uint8Array ||
    types.isProxy(signature)
  ) {
    return false;
  }

  return true;
}

/**
 * Exact CryptoKey success predicate for V2.1v resolver output.
 * Does not re-validate RS256 algorithm parameters (already enforced by V2.1v).
 *
 * @param {unknown} value
 * @returns {value is CryptoKey}
 */
function isExactCryptoKeyResult(value) {
  if (typeof CryptoKey === "undefined") {
    return false;
  }
  if (types.isProxy(value)) {
    return false;
  }
  if (!(value instanceof CryptoKey)) {
    return false;
  }
  if (
    Object.hasOwn(value, "type") ||
    Object.hasOwn(value, "usages") ||
    Object.hasOwn(value, "algorithm")
  ) {
    return false;
  }
  return true;
}

/**
 * Pure JWT access pre-session orchestrator (V2.1w / V2.1x).
 *
 * Returns TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE material only. Never validates
 * sessions, never authenticates identities, never authorizes.
 *
 * @param {unknown} compactToken
 * @param {unknown} expectedIssuer
 * @param {unknown} evaluationTime
 * @param {unknown} keyCandidates
 * @returns {Promise<{ sub: string, sid: string, jti: string } | null>}
 */
export async function verifyJwtAccessTokenCryptographically(
  compactToken,
  expectedIssuer,
  evaluationTime,
  keyCandidates,
) {
  try {
    const decoded = decodeJwtCompactStrict(compactToken);
    if (!isExactDecodedJwt(decoded)) {
      return null;
    }

    const protectedHeader = ownDataValue(decoded, "protectedHeader");
    const payload = ownDataValue(decoded, "payload");
    const signingInput = ownDataValue(decoded, "signingInput");
    const signature = ownDataValue(decoded, "signature");

    const claimsSatisfied = isJwtClaimsPolicySatisfied(
      protectedHeader,
      payload,
      expectedIssuer,
      evaluationTime,
    );
    if (claimsSatisfied !== true) {
      return null;
    }

    const verificationKey = resolveJwtRs256VerificationKey(
      ownDataValue(protectedHeader, "kid"),
      keyCandidates,
    );
    if (!isExactCryptoKeyResult(verificationKey)) {
      return null;
    }

    const signatureValid = await verifyJwtRs256Signature(
      signingInput,
      signature,
      verificationKey,
    );
    if (signatureValid !== true) {
      return null;
    }

    return {
      sub: ownDataValue(payload, "sub"),
      sid: ownDataValue(payload, "sid"),
      jti: ownDataValue(payload, "jti"),
    };
  } catch {
    return null;
  }
}
