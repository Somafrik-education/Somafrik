import { createTenantScope } from "../../domain/src/index.js";

import { isCanonicalRole } from "./roles.js";

class AuthPrincipalValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthPrincipalValidationError";
    this.code = "AUTH_PRINCIPAL_INVALID";
  }
}

const ALLOWED_FIELDS = new Set(["userId", "role", "tenantScope", "permissions"]);

function assertPlainObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthPrincipalValidationError("auth principal must be an object");
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

  const unexpectedFields = Object.keys(input).filter((field) => !ALLOWED_FIELDS.has(field));
  if (unexpectedFields.length > 0) {
    throw new AuthPrincipalValidationError(
      `unsupported auth principal fields: ${unexpectedFields.sort().join(", ")}`,
    );
  }

  if (!Object.prototype.hasOwnProperty.call(input, "permissions")) {
    throw new AuthPrincipalValidationError("permissions is required");
  }

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
