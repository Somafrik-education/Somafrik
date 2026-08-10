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

function rejectCode(value, field, kind) {
  if (value !== undefined && value !== null) {
    throw new TenantScopeValidationError(`${field} is forbidden for ${kind} scope`);
  }
}

export function createTenantScope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TenantScopeValidationError("tenant scope must be an object");
  }

  const allowedFields = new Set(["kind", "countryCode", "schoolCode"]);
  const unexpectedFields = Object.keys(input).filter((field) => !allowedFields.has(field));
  if (unexpectedFields.length > 0) {
    throw new TenantScopeValidationError(
      `unsupported tenant scope fields: ${unexpectedFields.sort().join(", ")}`,
    );
  }

  const { kind, countryCode, schoolCode } = input;

  if (kind === TENANT_SCOPE_KIND.PLATFORM) {
    rejectCode(countryCode, "countryCode", kind);
    rejectCode(schoolCode, "schoolCode", kind);
    return Object.freeze({ kind });
  }

  if (kind === TENANT_SCOPE_KIND.COUNTRY) {
    rejectCode(schoolCode, "schoolCode", kind);
    return Object.freeze({
      kind,
      countryCode: requiredCode(countryCode, "countryCode"),
    });
  }

  if (kind === TENANT_SCOPE_KIND.SCHOOL) {
    return Object.freeze({
      kind,
      countryCode: requiredCode(countryCode, "countryCode"),
      schoolCode: requiredCode(schoolCode, "schoolCode"),
    });
  }

  throw new TenantScopeValidationError(`unsupported tenant scope kind: ${String(kind)}`);
}
