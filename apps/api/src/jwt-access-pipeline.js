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

const DEFAULT_BRICKS = Object.freeze({
  decodeJwtCompactStrict,
  isJwtClaimsPolicySatisfied,
  resolveJwtRs256VerificationKey,
  verifyJwtRs256Signature,
});

/** @type {typeof DEFAULT_BRICKS} */
let bricks = { ...DEFAULT_BRICKS };

/**
 * Test-only seam to observe call order. Not part of the public API surface
 * and must not be re-exported from `index.js`.
 *
 * @param {Partial<typeof DEFAULT_BRICKS>} nextBricks
 * @returns {() => void} restore function
 */
export function __setJwtAccessPipelineBricksForTests(nextBricks) {
  bricks = { ...DEFAULT_BRICKS, ...nextBricks };
  return () => {
    bricks = { ...DEFAULT_BRICKS };
  };
}

/**
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

  const names = Object.getOwnPropertyNames(value);
  if (names.length !== DECODED_KEYS.length) {
    return false;
  }
  for (let index = 0; index < DECODED_KEYS.length; index += 1) {
    if (!Object.hasOwn(value, DECODED_KEYS[index])) {
      return false;
    }
  }

  const protectedHeader = value.protectedHeader;
  const payload = value.payload;
  const signingInput = value.signingInput;
  const signature = value.signature;

  if (
    protectedHeader === null ||
    typeof protectedHeader !== "object" ||
    Array.isArray(protectedHeader) ||
    types.isProxy(protectedHeader)
  ) {
    return false;
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    types.isProxy(payload)
  ) {
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
    const decoded = bricks.decodeJwtCompactStrict(compactToken);
    if (!isExactDecodedJwt(decoded)) {
      return null;
    }

    const claimsSatisfied = bricks.isJwtClaimsPolicySatisfied(
      decoded.protectedHeader,
      decoded.payload,
      expectedIssuer,
      evaluationTime,
    );
    if (claimsSatisfied !== true) {
      return null;
    }

    const verificationKey = bricks.resolveJwtRs256VerificationKey(
      decoded.protectedHeader.kid,
      keyCandidates,
    );
    if (!isExactCryptoKeyResult(verificationKey)) {
      return null;
    }

    const signatureValid = await bricks.verifyJwtRs256Signature(
      decoded.signingInput,
      decoded.signature,
      verificationKey,
    );
    if (signatureValid !== true) {
      return null;
    }

    return {
      sub: decoded.payload.sub,
      sid: decoded.payload.sid,
      jti: decoded.payload.jti,
    };
  } catch {
    return null;
  }
}
