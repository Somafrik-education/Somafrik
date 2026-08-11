import { types } from "node:util";

class AuthSessionAccessTokenValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthSessionAccessTokenValidationError";
    this.code = "AUTH_SESSION_ACCESS_TOKEN_INVALID";
  }
}

export const AUTH_SESSION_ACCESS_TOKEN_STATUS = Object.freeze({
  ACTIVE: "active",
  REVOKED: "revoked",
});

const REQUIRED_FIELDS = Object.freeze([
  "sessionId",
  "jti",
  "status",
  "issuedAt",
  "expiresAt",
  "revokedAt",
]);

const ALLOWED_FIELDS = Object.freeze(
  Object.assign(Object.create(null), {
    sessionId: true,
    jti: true,
    status: true,
    issuedAt: true,
    expiresAt: true,
    revokedAt: true,
  }),
);

const MAX_SESSION_ID_LENGTH = 128;
const MAX_JTI_LENGTH = 128;
const CANONICAL_UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;

function isDataDescriptor(descriptor) {
  return (
    Boolean(descriptor) &&
    Object.hasOwn(descriptor, "value") &&
    !Object.hasOwn(descriptor, "get") &&
    !Object.hasOwn(descriptor, "set")
  );
}

function assertPlainObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) {
    throw new AuthSessionAccessTokenValidationError("auth session access token must be an object");
  }
}

function rejectUnexpectedOwnKeys(input) {
  const unexpectedFields = [];
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "symbol" || !Object.hasOwn(ALLOWED_FIELDS, key)) {
      unexpectedFields[unexpectedFields.length] = typeof key === "symbol" ? String(key) : key;
    }
  }

  if (unexpectedFields.length > 0) {
    unexpectedFields.sort();
    throw new AuthSessionAccessTokenValidationError(
      `unsupported auth session access token fields: ${unexpectedFields.join(", ")}`,
    );
  }
}

function requireOwnDataValue(input, field) {
  if (!Object.hasOwn(input, field)) {
    throw new AuthSessionAccessTokenValidationError(`${field} is required as an own property`);
  }

  const descriptor = Reflect.getOwnPropertyDescriptor(input, field);
  if (!isDataDescriptor(descriptor)) {
    throw new AuthSessionAccessTokenValidationError(`${field} must be a data property`);
  }

  return descriptor.value;
}

function hasLeadingOrTrailingUnicodeWhitespace(value) {
  return /^\p{White_Space}/u.test(value) || /\p{White_Space}$/u.test(value);
}

function hasUnicodeControlCharacter(value) {
  return /\p{Cc}/u.test(value);
}

function requireSessionId(value) {
  if (typeof value !== "string") {
    throw new AuthSessionAccessTokenValidationError("sessionId must be a non-empty string");
  }
  if (value.length === 0 || value.length > MAX_SESSION_ID_LENGTH) {
    throw new AuthSessionAccessTokenValidationError("sessionId length is invalid");
  }
  if (hasLeadingOrTrailingUnicodeWhitespace(value)) {
    throw new AuthSessionAccessTokenValidationError(
      "sessionId must not have leading or trailing spaces",
    );
  }
  if (hasUnicodeControlCharacter(value)) {
    throw new AuthSessionAccessTokenValidationError(
      "sessionId must not contain control characters",
    );
  }
  return value;
}

function requireJti(value) {
  if (typeof value !== "string") {
    throw new AuthSessionAccessTokenValidationError("jti must be a string");
  }
  if (value.length < 1 || value.length > MAX_JTI_LENGTH) {
    throw new AuthSessionAccessTokenValidationError("jti length is invalid");
  }
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const isUpper = codeUnit >= 65 && codeUnit <= 90;
    const isLower = codeUnit >= 97 && codeUnit <= 122;
    const isDigit = codeUnit >= 48 && codeUnit <= 57;
    const isAllowedPunctuation =
      codeUnit === 46 || codeUnit === 95 || codeUnit === 58 || codeUnit === 45;
    if (!isUpper && !isLower && !isDigit && !isAllowedPunctuation) {
      throw new AuthSessionAccessTokenValidationError("jti format is invalid");
    }
  }
  return value;
}

function requireCanonicalUtcTimestamp(value, field) {
  if (typeof value !== "string") {
    throw new AuthSessionAccessTokenValidationError(`${field} must be a canonical UTC timestamp`);
  }
  if (!CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) {
    throw new AuthSessionAccessTokenValidationError(`${field} must be a canonical UTC timestamp`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new AuthSessionAccessTokenValidationError(`${field} must be a canonical UTC timestamp`);
  }

  return value;
}

function requireStatus(value) {
  if (value !== AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE && value !== AUTH_SESSION_ACCESS_TOKEN_STATUS.REVOKED) {
    throw new AuthSessionAccessTokenValidationError("status must be active or revoked");
  }
  return value;
}

function requireRevokedAt(value, status, issuedAt) {
  if (status === AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE) {
    if (value !== null) {
      throw new AuthSessionAccessTokenValidationError("active token must have revokedAt null");
    }
    return null;
  }

  const revokedAt = requireCanonicalUtcTimestamp(value, "revokedAt");
  if (revokedAt < issuedAt) {
    throw new AuthSessionAccessTokenValidationError(
      "revokedAt must be greater than or equal to issuedAt",
    );
  }
  return revokedAt;
}

function createAuthSessionAccessTokenUnchecked(input) {
  assertPlainObject(input);

  for (let index = 0; index < REQUIRED_FIELDS.length; index += 1) {
    const field = Reflect.get(REQUIRED_FIELDS, String(index));
    if (!Object.hasOwn(input, field)) {
      throw new AuthSessionAccessTokenValidationError(`${field} is required as an own property`);
    }
  }

  rejectUnexpectedOwnKeys(input);

  const sessionId = requireSessionId(requireOwnDataValue(input, "sessionId"));
  const jti = requireJti(requireOwnDataValue(input, "jti"));
  const status = requireStatus(requireOwnDataValue(input, "status"));
  const issuedAt = requireCanonicalUtcTimestamp(requireOwnDataValue(input, "issuedAt"), "issuedAt");
  const expiresAt = requireCanonicalUtcTimestamp(
    requireOwnDataValue(input, "expiresAt"),
    "expiresAt",
  );
  if (expiresAt <= issuedAt) {
    throw new AuthSessionAccessTokenValidationError(
      "expiresAt must be strictly greater than issuedAt",
    );
  }

  const revokedAt = requireRevokedAt(requireOwnDataValue(input, "revokedAt"), status, issuedAt);

  return Object.freeze({
    sessionId,
    jti,
    status,
    issuedAt,
    expiresAt,
    revokedAt,
  });
}

export function createAuthSessionAccessToken(input) {
  try {
    return createAuthSessionAccessTokenUnchecked(input);
  } catch (error) {
    if (
      error &&
      error.name === "AuthSessionAccessTokenValidationError" &&
      error.code === "AUTH_SESSION_ACCESS_TOKEN_INVALID"
    ) {
      throw error;
    }
    throw new AuthSessionAccessTokenValidationError("auth session access token is invalid");
  }
}

export function isAuthSessionAccessTokenActive(accessToken, evaluationTime) {
  try {
    if (typeof evaluationTime !== "string" || !CANONICAL_UTC_TIMESTAMP_PATTERN.test(evaluationTime)) {
      return false;
    }
    const parsedNow = new Date(evaluationTime);
    if (Number.isNaN(parsedNow.getTime()) || parsedNow.toISOString() !== evaluationTime) {
      return false;
    }

    const validated = createAuthSessionAccessToken(accessToken);
    if (validated.status !== AUTH_SESSION_ACCESS_TOKEN_STATUS.ACTIVE) {
      return false;
    }
    if (validated.revokedAt !== null) {
      return false;
    }
    if (evaluationTime < validated.issuedAt) {
      return false;
    }
    if (evaluationTime >= validated.expiresAt) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
