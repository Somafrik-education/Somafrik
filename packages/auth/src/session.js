import { AUTH_IDENTITY_STATUS, createAuthIdentity } from "./identity.js";
import { createAuthPrincipal } from "./principal.js";

class AuthSessionValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthSessionValidationError";
    this.code = "AUTH_SESSION_INVALID";
  }
}

const REQUIRED_FIELDS = Object.freeze([
  "sessionId",
  "identity",
  "principal",
  "issuedAt",
  "expiresAt",
  "revokedAt",
]);

const ALLOWED_FIELDS = Object.freeze(
  Object.assign(Object.create(null), {
    sessionId: true,
    identity: true,
    principal: true,
    issuedAt: true,
    expiresAt: true,
    revokedAt: true,
  }),
);

const MAX_SESSION_ID_LENGTH = 128;
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
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthSessionValidationError("auth session must be an object");
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
    throw new AuthSessionValidationError(
      `unsupported auth session fields: ${unexpectedFields.join(", ")}`,
    );
  }
}

function requireOwnDataValue(input, field) {
  if (!Object.hasOwn(input, field)) {
    throw new AuthSessionValidationError(`${field} is required as an own property`);
  }

  const descriptor = Reflect.getOwnPropertyDescriptor(input, field);
  if (!isDataDescriptor(descriptor)) {
    throw new AuthSessionValidationError(`${field} must be a data property`);
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
    throw new AuthSessionValidationError("sessionId must be a non-empty string");
  }
  if (value.length === 0 || value.length > MAX_SESSION_ID_LENGTH) {
    throw new AuthSessionValidationError("sessionId length is invalid");
  }
  if (hasLeadingOrTrailingUnicodeWhitespace(value)) {
    throw new AuthSessionValidationError("sessionId must not have leading or trailing spaces");
  }
  if (hasUnicodeControlCharacter(value)) {
    throw new AuthSessionValidationError("sessionId must not contain control characters");
  }
  return value;
}

function requireCanonicalUtcTimestamp(value, field) {
  if (typeof value !== "string") {
    throw new AuthSessionValidationError(`${field} must be a canonical UTC timestamp`);
  }
  if (!CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) {
    throw new AuthSessionValidationError(`${field} must be a canonical UTC timestamp`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new AuthSessionValidationError(`${field} must be a canonical UTC timestamp`);
  }

  return value;
}

function requireActiveIdentity(value) {
  let identity;
  try {
    identity = createAuthIdentity(value);
  } catch {
    throw new AuthSessionValidationError("identity is invalid");
  }

  if (identity.status !== AUTH_IDENTITY_STATUS.ACTIVE) {
    throw new AuthSessionValidationError("identity must be active");
  }

  return identity;
}

function requirePrincipal(value) {
  try {
    return createAuthPrincipal(value);
  } catch {
    throw new AuthSessionValidationError("principal is invalid");
  }
}

function requireRevokedAt(value, issuedAt) {
  if (value === null) {
    return null;
  }

  const revokedAt = requireCanonicalUtcTimestamp(value, "revokedAt");
  if (revokedAt < issuedAt) {
    throw new AuthSessionValidationError("revokedAt must be greater than or equal to issuedAt");
  }
  return revokedAt;
}

function createAuthSessionUnchecked(input) {
  assertPlainObject(input);

  for (let index = 0; index < REQUIRED_FIELDS.length; index += 1) {
    const field = Reflect.get(REQUIRED_FIELDS, String(index));
    if (!Object.hasOwn(input, field)) {
      throw new AuthSessionValidationError(`${field} is required as an own property`);
    }
  }

  rejectUnexpectedOwnKeys(input);

  const sessionId = requireSessionId(requireOwnDataValue(input, "sessionId"));
  const identity = requireActiveIdentity(requireOwnDataValue(input, "identity"));
  const principal = requirePrincipal(requireOwnDataValue(input, "principal"));

  if (principal.userId !== identity.userId) {
    throw new AuthSessionValidationError("principal userId must match identity userId");
  }

  const issuedAt = requireCanonicalUtcTimestamp(requireOwnDataValue(input, "issuedAt"), "issuedAt");
  const expiresAt = requireCanonicalUtcTimestamp(
    requireOwnDataValue(input, "expiresAt"),
    "expiresAt",
  );
  if (expiresAt <= issuedAt) {
    throw new AuthSessionValidationError("expiresAt must be strictly greater than issuedAt");
  }

  const revokedAt = requireRevokedAt(requireOwnDataValue(input, "revokedAt"), issuedAt);

  return Object.freeze({
    sessionId,
    identity,
    principal,
    issuedAt,
    expiresAt,
    revokedAt,
  });
}

export function createAuthSession(input) {
  try {
    return createAuthSessionUnchecked(input);
  } catch (error) {
    if (
      error &&
      error.name === "AuthSessionValidationError" &&
      error.code === "AUTH_SESSION_INVALID"
    ) {
      throw error;
    }
    throw new AuthSessionValidationError("auth session is invalid");
  }
}

export function isAuthSessionActive(session, now) {
  try {
    if (typeof now !== "string" || !CANONICAL_UTC_TIMESTAMP_PATTERN.test(now)) {
      return false;
    }
    const parsedNow = new Date(now);
    if (Number.isNaN(parsedNow.getTime()) || parsedNow.toISOString() !== now) {
      return false;
    }

    const validated = createAuthSession(session);
    if (validated.identity.status !== AUTH_IDENTITY_STATUS.ACTIVE) {
      return false;
    }
    if (validated.principal.userId !== validated.identity.userId) {
      return false;
    }
    if (validated.revokedAt !== null) {
      return false;
    }
    if (now < validated.issuedAt) {
      return false;
    }
    if (now >= validated.expiresAt) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
