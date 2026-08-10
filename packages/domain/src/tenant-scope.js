export const TENANT_SCOPE_KIND = Object.freeze({
  PLATFORM: "platform",
  COUNTRY: "country",
  SCHOOL: "school",
});

export class TenantScopeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TenantScopeValidationError";
    this.code = "TENANT_SCOPE_INVALID";
  }
}

const ALLOWED_FIELDS = new Set(["kind", "countryCode", "schoolCode"]);

function assertOrdinaryObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TenantScopeValidationError("tenant scope must be an object");
  }

  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TenantScopeValidationError("tenant scope must be an ordinary object");
  }
}

function requireOwnField(input, field) {
  if (!Object.hasOwn(input, field)) {
    throw new TenantScopeValidationError(`${field} is required as an own property`);
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
    throw new TenantScopeValidationError(
      `unsupported tenant scope fields: ${unexpectedFields.join(", ")}`,
    );
  }
}

function optionalCode(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TenantScopeValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requiredCode(value, field) {
  const code = optionalCode(value, field);
  if (code === null) {
    throw new TenantScopeValidationError(`${field} is required`);
  }
  return code;
}

function rejectOwnCode(input, field, kind) {
  if (!Object.hasOwn(input, field)) {
    return;
  }

  const value = Reflect.get(input, field);
  if (value !== undefined && value !== null) {
    throw new TenantScopeValidationError(`${field} is forbidden for ${kind} scope`);
  }
}

export function createTenantScope(input) {
  assertOrdinaryObject(input);
  requireOwnField(input, "kind");
  rejectUnexpectedOwnKeys(input);

  const kind = Reflect.get(input, "kind");

  if (kind === TENANT_SCOPE_KIND.PLATFORM) {
    rejectOwnCode(input, "countryCode", kind);
    rejectOwnCode(input, "schoolCode", kind);
    return Object.freeze({ kind });
  }

  if (kind === TENANT_SCOPE_KIND.COUNTRY) {
    requireOwnField(input, "countryCode");
    rejectOwnCode(input, "schoolCode", kind);
    return Object.freeze({
      kind,
      countryCode: requiredCode(Reflect.get(input, "countryCode"), "countryCode"),
    });
  }

  if (kind === TENANT_SCOPE_KIND.SCHOOL) {
    requireOwnField(input, "countryCode");
    requireOwnField(input, "schoolCode");
    return Object.freeze({
      kind,
      countryCode: requiredCode(Reflect.get(input, "countryCode"), "countryCode"),
      schoolCode: requiredCode(Reflect.get(input, "schoolCode"), "schoolCode"),
    });
  }

  throw new TenantScopeValidationError(`unsupported tenant scope kind: ${String(kind)}`);
}
