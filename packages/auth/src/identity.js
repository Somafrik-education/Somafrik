class AuthIdentityValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthIdentityValidationError";
    this.code = "AUTH_IDENTITY_INVALID";
  }
}

export const AUTH_IDENTITY_STATUS = Object.freeze({
  ACTIVE: "active",
  DISABLED: "disabled",
});

const AUTH_IDENTITY_STATUS_LOOKUP = Object.freeze(
  Object.assign(Object.create(null), {
    active: true,
    disabled: true,
  }),
);

const REQUIRED_FIELDS = Object.freeze(["userId", "status", "createdAt", "disabledAt"]);
const ALLOWED_FIELDS = Object.freeze(
  Object.assign(Object.create(null), {
    userId: true,
    status: true,
    createdAt: true,
    disabledAt: true,
  }),
);

const MAX_USER_ID_LENGTH = 128;
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
    throw new AuthIdentityValidationError("auth identity must be an object");
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
    throw new AuthIdentityValidationError(
      `unsupported auth identity fields: ${unexpectedFields.join(", ")}`,
    );
  }
}

function requireOwnDataValue(input, field) {
  if (!Object.hasOwn(input, field)) {
    throw new AuthIdentityValidationError(`${field} is required as an own property`);
  }

  const descriptor = Reflect.getOwnPropertyDescriptor(input, field);
  if (!isDataDescriptor(descriptor)) {
    throw new AuthIdentityValidationError(`${field} must be a data property`);
  }

  return descriptor.value;
}

function isAsciiControlCharacter(codeUnit) {
  return (codeUnit >= 0 && codeUnit <= 31) || codeUnit === 127;
}

function requireUserId(value) {
  if (typeof value !== "string") {
    throw new AuthIdentityValidationError("userId must be a non-empty string");
  }
  if (value.length === 0 || value.length > MAX_USER_ID_LENGTH) {
    throw new AuthIdentityValidationError("userId length is invalid");
  }

  const firstCode = value.charCodeAt(0);
  const lastCode = value.charCodeAt(value.length - 1);
  if (firstCode === 32 || lastCode === 32) {
    throw new AuthIdentityValidationError("userId must not have leading or trailing spaces");
  }

  for (let index = 0; index < value.length; index += 1) {
    if (isAsciiControlCharacter(value.charCodeAt(index))) {
      throw new AuthIdentityValidationError("userId must not contain control characters");
    }
  }

  return value;
}

function requireStatus(value) {
  if (typeof value !== "string" || !Object.hasOwn(AUTH_IDENTITY_STATUS_LOOKUP, value)) {
    throw new AuthIdentityValidationError("status is invalid");
  }
  return value;
}

function requireCanonicalUtcTimestamp(value, field) {
  if (typeof value !== "string") {
    throw new AuthIdentityValidationError(`${field} must be a canonical UTC timestamp`);
  }
  if (!CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) {
    throw new AuthIdentityValidationError(`${field} must be a canonical UTC timestamp`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new AuthIdentityValidationError(`${field} must be a canonical UTC timestamp`);
  }

  return value;
}

function requireDisabledAt(value, status, createdAt) {
  if (status === AUTH_IDENTITY_STATUS.ACTIVE) {
    if (value !== null) {
      throw new AuthIdentityValidationError("disabledAt must be null for an active identity");
    }
    return null;
  }

  if (value === null) {
    throw new AuthIdentityValidationError("disabledAt is required for a disabled identity");
  }

  const disabledAt = requireCanonicalUtcTimestamp(value, "disabledAt");
  if (disabledAt < createdAt) {
    throw new AuthIdentityValidationError("disabledAt must be greater than or equal to createdAt");
  }
  return disabledAt;
}

function createAuthIdentityUnchecked(input) {
  assertPlainObject(input);

  for (let index = 0; index < REQUIRED_FIELDS.length; index += 1) {
    const field = Reflect.get(REQUIRED_FIELDS, String(index));
    if (!Object.hasOwn(input, field)) {
      throw new AuthIdentityValidationError(`${field} is required as an own property`);
    }
  }

  rejectUnexpectedOwnKeys(input);

  const userId = requireUserId(requireOwnDataValue(input, "userId"));
  const status = requireStatus(requireOwnDataValue(input, "status"));
  const createdAt = requireCanonicalUtcTimestamp(requireOwnDataValue(input, "createdAt"), "createdAt");
  const disabledAt = requireDisabledAt(requireOwnDataValue(input, "disabledAt"), status, createdAt);

  return Object.freeze({
    userId,
    status,
    createdAt,
    disabledAt,
  });
}

export function createAuthIdentity(input) {
  try {
    return createAuthIdentityUnchecked(input);
  } catch (error) {
    if (
      error &&
      error.name === "AuthIdentityValidationError" &&
      error.code === "AUTH_IDENTITY_INVALID"
    ) {
      throw error;
    }
    throw new AuthIdentityValidationError("auth identity is invalid");
  }
}

export function isAuthIdentityActive(identity) {
  try {
    const validated = createAuthIdentity(identity);
    return validated.status === AUTH_IDENTITY_STATUS.ACTIVE;
  } catch {
    return false;
  }
}
