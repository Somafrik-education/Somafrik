import { createTenantScope } from "../../domain/src/index.js";

import { isCanonicalRole } from "./roles.js";

class AuthPrincipalValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthPrincipalValidationError";
    this.code = "AUTH_PRINCIPAL_INVALID";
  }
}

const REQUIRED_FIELDS = Object.freeze(["userId", "role", "tenantScope", "permissions"]);
const ALLOWED_FIELDS = Object.freeze(
  Object.assign(Object.create(null), {
    userId: true,
    role: true,
    tenantScope: true,
    permissions: true,
  }),
);

function assertPlainObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthPrincipalValidationError("auth principal must be an object");
  }
}

function requireOwnField(input, field) {
  if (!Object.hasOwn(input, field)) {
    throw new AuthPrincipalValidationError(`${field} is required as an own property`);
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
    throw new AuthPrincipalValidationError(
      `unsupported auth principal fields: ${unexpectedFields.join(", ")}`,
    );
  }
}

function requireUserId(value) {
  if (typeof value !== "string") {
    throw new AuthPrincipalValidationError("userId must be a non-empty string");
  }
  if (value.trim() === "") {
    throw new AuthPrincipalValidationError("userId must be a non-empty string");
  }
  return value;
}

function requireCanonicalRole(value) {
  if (!isCanonicalRole(value)) {
    throw new AuthPrincipalValidationError(`unsupported auth principal role: ${String(value)}`);
  }
  return value;
}

function isDataDescriptor(descriptor) {
  return (
    Boolean(descriptor) &&
    Object.hasOwn(descriptor, "value") &&
    !Object.hasOwn(descriptor, "get") &&
    !Object.hasOwn(descriptor, "set")
  );
}

function isCanonicalArrayIndexKey(key, length) {
  if (typeof key !== "string" || length <= 0) {
    return false;
  }
  if (!/^(0|[1-9]\d*)$/.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function requirePermissionValue(permission, index) {
  if (typeof permission !== "string") {
    throw new AuthPrincipalValidationError(`permissions[${index}] must be a non-empty string`);
  }
  if (permission.trim() === "") {
    throw new AuthPrincipalValidationError(`permissions[${index}] must be a non-empty string`);
  }
  return permission;
}

function requirePermissions(value) {
  if (!Array.isArray(value)) {
    throw new AuthPrincipalValidationError("permissions must be an array");
  }

  if (!Object.hasOwn(value, "length")) {
    throw new AuthPrincipalValidationError("permissions length is required as an own property");
  }

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  if (!isDataDescriptor(lengthDescriptor)) {
    throw new AuthPrincipalValidationError("permissions length must be a data property");
  }

  const length = lengthDescriptor.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
    throw new AuthPrincipalValidationError("permissions length must be a non-negative integer");
  }

  const ownKeys = Reflect.ownKeys(value);
  const indexKeys = [];
  let indexCount = 0;

  for (const key of ownKeys) {
    if (key === "length") {
      continue;
    }
    if (typeof key === "symbol" || !isCanonicalArrayIndexKey(key, length)) {
      throw new AuthPrincipalValidationError(
        `unsupported permissions own keys: ${typeof key === "symbol" ? String(key) : key}`,
      );
    }
    indexKeys[indexCount] = key;
    indexCount += 1;
  }

  if (indexCount !== length) {
    throw new AuthPrincipalValidationError("permissions must be a dense own-keyed array");
  }

  const permissions = new Array(length);
  for (let offset = 0; offset < indexCount; offset += 1) {
    const indexKey = indexKeys[offset];
    const descriptor = Reflect.getOwnPropertyDescriptor(value, indexKey);
    if (!isDataDescriptor(descriptor)) {
      throw new AuthPrincipalValidationError(
        `permissions[${indexKey}] must be a data property`,
      );
    }

    const index = Number(indexKey);
    permissions[index] = requirePermissionValue(descriptor.value, index);
  }

  return Object.freeze(permissions);
}

export function createAuthPrincipal(input) {
  assertPlainObject(input);

  for (let index = 0; index < REQUIRED_FIELDS.length; index += 1) {
    requireOwnField(input, Reflect.get(REQUIRED_FIELDS, String(index)));
  }

  rejectUnexpectedOwnKeys(input);

  const userId = requireUserId(Reflect.get(input, "userId"));
  const role = requireCanonicalRole(Reflect.get(input, "role"));
  const tenantScope = createTenantScope(Reflect.get(input, "tenantScope"));
  const permissions = requirePermissions(Reflect.get(input, "permissions"));

  return Object.freeze({
    userId,
    role,
    tenantScope,
    permissions,
  });
}
