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
const ALLOWED_FIELDS = new Set(REQUIRED_FIELDS);

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
    if (typeof key === "symbol" || !ALLOWED_FIELDS.has(key)) {
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

function requirePermissions(value) {
  if (!Array.isArray(value)) {
    throw new AuthPrincipalValidationError("permissions must be an array");
  }

  if (!Object.hasOwn(value, "length")) {
    throw new AuthPrincipalValidationError("permissions length is required as an own property");
  }

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor ? lengthDescriptor.value : undefined;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
    throw new AuthPrincipalValidationError("permissions length must be a non-negative integer");
  }

  const allowedIndexKeys = new Set();
  for (let index = 0; index < length; index += 1) {
    allowedIndexKeys.add(String(index));
  }

  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") {
      continue;
    }
    if (typeof key === "symbol" || !allowedIndexKeys.has(key)) {
      throw new AuthPrincipalValidationError(
        `unsupported permissions own keys: ${typeof key === "symbol" ? String(key) : key}`,
      );
    }
  }

  const permissions = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const indexKey = String(index);
    if (!Object.hasOwn(value, indexKey)) {
      throw new AuthPrincipalValidationError(`permissions[${index}] is required as an own property`);
    }

    const permission = Reflect.get(value, indexKey);
    if (typeof permission !== "string") {
      throw new AuthPrincipalValidationError(`permissions[${index}] must be a non-empty string`);
    }
    if (permission.trim() === "") {
      throw new AuthPrincipalValidationError(`permissions[${index}] must be a non-empty string`);
    }
    permissions[index] = permission;
  }

  return Object.freeze(permissions);
}

export function createAuthPrincipal(input) {
  assertPlainObject(input);

  for (const field of REQUIRED_FIELDS) {
    requireOwnField(input, field);
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
