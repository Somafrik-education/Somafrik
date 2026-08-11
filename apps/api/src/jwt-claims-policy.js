import { isJwtTemporalPolicySatisfied } from "./jwt-temporal-policy.js";

const EXPECTED_AUDIENCE = "somafrik-api-v2";
const EXPECTED_ALG = "RS256";
const EXPECTED_TYP = "JWT";
const HEADER_KEYS = ["alg", "typ", "kid"];
const PAYLOAD_KEYS = ["iss", "aud", "sub", "sid", "iat", "nbf", "exp", "jti"];
const TOKEN_ID_MAX_LENGTH = 128;
const ISSUER_MAX_LENGTH = 2048;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isOrdinaryObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
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
 * @param {readonly string[]} expectedKeys
 * @returns {boolean}
 */
function hasExactOwnDataKeys(object, expectedKeys) {
  const names = Object.getOwnPropertyNames(object);
  if (names.length !== expectedKeys.length) {
    return false;
  }

  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = expectedKeys[index];
    if (!Object.hasOwn(object, key) || !isOwnDataProperty(object, key)) {
      return false;
    }
  }

  return true;
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
 * @param {unknown} value
 * @returns {boolean}
 */
function isStrictAsciiTokenId(value) {
  if (typeof value !== "string") {
    return false;
  }

  const length = value.length;
  if (length < 1 || length > TOKEN_ID_MAX_LENGTH) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const isUpper = codeUnit >= 65 && codeUnit <= 90;
    const isLower = codeUnit >= 97 && codeUnit <= 122;
    const isDigit = codeUnit >= 48 && codeUnit <= 57;
    const isAllowedPunctuation =
      codeUnit === 46 ||
      codeUnit === 95 ||
      codeUnit === 58 ||
      codeUnit === 45;
    if (!isUpper && !isLower && !isDigit && !isAllowedPunctuation) {
      return false;
    }
  }

  return true;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidIssuerString(value) {
  if (typeof value !== "string") {
    return false;
  }

  const length = value.length;
  if (length < 1 || length > ISSUER_MAX_LENGTH) {
    return false;
  }

  if (value.charCodeAt(0) === 0x20 || value.charCodeAt(length - 1) === 0x20) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return false;
    }
  }

  return true;
}

/**
 * Pure structural + temporal claims policy check for JWT access tokens (V2.1o / V2.1p).
 *
 * Inputs must already be decoded and injected. Never parses serialized payloads,
 * never decodes compact token segments, never verifies signatures, and never
 * authorizes access.
 *
 * @param {unknown} protectedHeader
 * @param {unknown} payload
 * @param {unknown} expectedIssuer
 * @param {unknown} evaluationTime
 * @returns {boolean}
 */
export function isJwtClaimsPolicySatisfied(
  protectedHeader,
  payload,
  expectedIssuer,
  evaluationTime,
) {
  try {
    if (!isOrdinaryObject(protectedHeader)) {
      return false;
    }
    if (!hasExactOwnDataKeys(protectedHeader, HEADER_KEYS)) {
      return false;
    }

    const alg = ownDataValue(protectedHeader, "alg");
    const typ = ownDataValue(protectedHeader, "typ");
    const kid = ownDataValue(protectedHeader, "kid");
    if (alg !== EXPECTED_ALG || typ !== EXPECTED_TYP || !isStrictAsciiTokenId(kid)) {
      return false;
    }

    if (!isOrdinaryObject(payload)) {
      return false;
    }
    if (!hasExactOwnDataKeys(payload, PAYLOAD_KEYS)) {
      return false;
    }

    const iss = ownDataValue(payload, "iss");
    const aud = ownDataValue(payload, "aud");
    const sub = ownDataValue(payload, "sub");
    const sid = ownDataValue(payload, "sid");
    const iat = ownDataValue(payload, "iat");
    const nbf = ownDataValue(payload, "nbf");
    const exp = ownDataValue(payload, "exp");
    const jti = ownDataValue(payload, "jti");

    if (!isValidIssuerString(expectedIssuer) || !isValidIssuerString(iss)) {
      return false;
    }
    if (iss !== expectedIssuer) {
      return false;
    }
    if (aud !== EXPECTED_AUDIENCE) {
      return false;
    }
    if (
      !isStrictAsciiTokenId(sub) ||
      !isStrictAsciiTokenId(sid) ||
      !isStrictAsciiTokenId(jti)
    ) {
      return false;
    }

    return isJwtTemporalPolicySatisfied(iat, nbf, exp, evaluationTime) === true;
  } catch {
    return false;
  }
}
