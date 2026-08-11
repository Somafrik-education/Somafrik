import {
  AUTH_SESSION_ACCESS_TOKEN_STATUS,
  createAuthSessionAccessToken,
  isAuthSessionAccessTokenActive,
} from "./session-access-token.js";
import { createAuthSession, isAuthSessionActive } from "./session.js";

const CRYPTO_TOKEN_KEYS = Object.freeze(["sub", "sid", "jti"]);
const TOKEN_ID_MAX_LENGTH = 128;

function isDataDescriptor(descriptor) {
  return (
    Boolean(descriptor) &&
    Object.hasOwn(descriptor, "value") &&
    !Object.hasOwn(descriptor, "get") &&
    !Object.hasOwn(descriptor, "set")
  );
}

function isOrdinaryObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return true;
}

function hasExactOwnDataKeys(value, expectedKeys) {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length) {
    return false;
  }
  for (let index = 0; index < expectedKeys.length; index += 1) {
    const key = Reflect.get(expectedKeys, String(index));
    if (!Object.hasOwn(value, key)) {
      return false;
    }
    if (!isDataDescriptor(Reflect.getOwnPropertyDescriptor(value, key))) {
      return false;
    }
  }
  for (let index = 0; index < ownKeys.length; index += 1) {
    const key = Reflect.get(ownKeys, String(index));
    if (typeof key !== "string") {
      return false;
    }
    let found = false;
    for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
      if (key === Reflect.get(expectedKeys, String(expectedIndex))) {
        found = true;
        break;
      }
    }
    if (!found) {
      return false;
    }
  }
  return true;
}

/**
 * Exact alphabet shared with JWT claim ids and AuthSessionAccessToken.jti:
 * ^[A-Za-z0-9._:-]{1,128}$
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
      codeUnit === 46 || codeUnit === 95 || codeUnit === 58 || codeUnit === 45;
    if (!isUpper && !isLower && !isDigit && !isAllowedPunctuation) {
      return false;
    }
  }
  return true;
}

/**
 * Exact TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE shape from V2.1x,
 * with fail-closed id alphabet for sub / sid / jti.
 * Does not re-run claims / temporal / kid / RS256 policies.
 * @param {unknown} value
 * @returns {value is { sub: string, sid: string, jti: string }}
 */
function isCryptographicallyAdmissibleToken(value) {
  if (!isOrdinaryObject(value)) {
    return false;
  }
  if (!hasExactOwnDataKeys(value, CRYPTO_TOKEN_KEYS)) {
    return false;
  }
  const { sub, sid, jti } = /** @type {{ sub: unknown, sid: unknown, jti: unknown }} */ (value);
  return isStrictAsciiTokenId(sub) && isStrictAsciiTokenId(sid) && isStrictAsciiTokenId(jti);
}

/**
 * Validates JWT ↔ AuthSession ↔ AuthSessionAccessToken binding.
 * Non-null return = JWT_BOUND_ACTIVE_SESSION only.
 * Fail-closed: never throws to the caller; never rejects the promise.
 *
 * @param {unknown} cryptographicallyAdmissibleToken
 * @param {unknown} authSession
 * @param {unknown} authSessionAccessToken
 * @param {unknown} sessionEvaluationTime
 * @returns {Promise<{ sub: string, sid: string, jti: string, principal: object } | null>}
 */
export async function validateJwtBoundAuthSession(
  cryptographicallyAdmissibleToken,
  authSession,
  authSessionAccessToken,
  sessionEvaluationTime,
) {
  try {
    if (!isCryptographicallyAdmissibleToken(cryptographicallyAdmissibleToken)) {
      return null;
    }

    let session;
    try {
      session = createAuthSession(authSession);
    } catch {
      return null;
    }

    if (isAuthSessionActive(session, sessionEvaluationTime) !== true) {
      return null;
    }

    let accessToken;
    try {
      accessToken = createAuthSessionAccessToken(authSessionAccessToken);
    } catch {
      return null;
    }

    if (accessToken.status !== AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE) {
      return null;
    }

    if (isAuthSessionAccessTokenActive(accessToken, sessionEvaluationTime) !== true) {
      return null;
    }

    if (cryptographicallyAdmissibleToken.sid !== session.sessionId) {
      return null;
    }
    if (cryptographicallyAdmissibleToken.sub !== session.identity.userId) {
      return null;
    }
    if (session.principal.userId !== session.identity.userId) {
      return null;
    }
    if (cryptographicallyAdmissibleToken.jti !== accessToken.jti) {
      return null;
    }
    if (accessToken.sessionId !== session.sessionId) {
      return null;
    }

    return Object.freeze({
      sub: cryptographicallyAdmissibleToken.sub,
      sid: cryptographicallyAdmissibleToken.sid,
      jti: cryptographicallyAdmissibleToken.jti,
      principal: session.principal,
    });
  } catch {
    return null;
  }
}
