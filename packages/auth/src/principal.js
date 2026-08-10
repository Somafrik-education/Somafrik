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
  const unexpectedFields = Reflect.ownKeys(input).filter((key) => {
    return typeof key === "symbol" || !ALLOWED_FIELDS.has(key);
  });

  if (unexpectedFields.length > 0) {
    const labels = unexpectedFields.map((key) => (typeof key === "symbol" ? String(key) : key));
    throw new AuthPrincipalValidationError(
      `unsupported auth principal fields: ${labels.sort().join(", ")}`,
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

  const permissions = value.map((permission, index) => {
    if (typeof permission !== "string") {
      throw new AuthPrincipalValidationError(`permissions[${index}] must be a non-empty string`);
    }
    if (permission.trim() === "") {
      throw new AuthPrincipalValidationError(`permissions[${index}] must be a non-empty string`);
    }
    return permission;
  });

  return Object.freeze(permissions.slice());
}

export function createAuthPrincipal(input) {
  assertPlainObject(input);

  for (const field of REQUIRED_FIELDS) {
    requireOwnField(input, field);
  }

  rejectUnexpectedOwnKeys(input);

  const userId = requireUserId(input.userId);
  const role = requireCanonicalRole(input.role);
  const tenantScope = createTenantScope(input.tenantScope);
  const permissions = requirePermissions(input.permissions);

  return Object.freeze({
    userId,
    role,
    tenantScope,
    permissions,
  });
}
