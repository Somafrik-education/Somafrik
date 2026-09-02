import assert from "node:assert/strict";
import test from "node:test";

import {
  TENANT_SCOPE_KIND,
  TenantScopeValidationError,
  createTenantScope,
} from "../src/index.js";

test("creates an immutable platform scope without tenant codes", () => {
  const scope = createTenantScope({ kind: TENANT_SCOPE_KIND.PLATFORM });

  assert.deepEqual(scope, { kind: "platform" });
  assert.equal(Object.isFrozen(scope), true);
});

test("normalizes country and school codes for a school scope", () => {
  const scope = createTenantScope({
    kind: TENANT_SCOPE_KIND.SCHOOL,
    countryCode: "  CD ",
    schoolCode: " CD-2026-0001 ",
  });

  assert.deepEqual(scope, {
    kind: "school",
    countryCode: "CD",
    schoolCode: "CD-2026-0001",
  });
});

test("rejects an incomplete country or school scope", () => {
  assert.throws(
    () => createTenantScope({ kind: TENANT_SCOPE_KIND.COUNTRY }),
    (error) => error instanceof TenantScopeValidationError && error.code === "TENANT_SCOPE_INVALID",
  );
  assert.throws(
    () => createTenantScope({ kind: TENANT_SCOPE_KIND.SCHOOL, countryCode: "CD" }),
    /schoolCode is required/,
  );
});

test("rejects tenant codes outside their declared scope", () => {
  assert.throws(
    () => createTenantScope({ kind: TENANT_SCOPE_KIND.PLATFORM, countryCode: "CD" }),
    /countryCode is forbidden for platform scope/,
  );
  assert.throws(
    () =>
      createTenantScope({
        kind: TENANT_SCOPE_KIND.COUNTRY,
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
      }),
    /schoolCode is forbidden for country scope/,
  );
});

test("rejects unknown scope kinds instead of widening access", () => {
  assert.throws(
    () => createTenantScope({ kind: "global" }),
    /unsupported tenant scope kind: global/,
  );
});

test("rejects unexpected scope fields instead of ignoring ambiguous context", () => {
  assert.throws(
    () =>
      createTenantScope({
        kind: TENANT_SCOPE_KIND.SCHOOL,
        countryCode: "CD",
        schoolCode: "CD-2026-0001",
        organizationCode: "legacy-tenant",
      }),
    /unsupported tenant scope fields: organizationCode/,
  );
});

test("rejects inherited kind, countryCode, or schoolCode values", () => {
  const inheritedKind = Object.create({ kind: TENANT_SCOPE_KIND.PLATFORM });
  assert.throws(
    () => createTenantScope(inheritedKind),
    /tenant scope must be an ordinary object/,
  );

  const inheritedCountry = Object.create({ countryCode: "CD" });
  inheritedCountry.kind = TENANT_SCOPE_KIND.COUNTRY;
  assert.throws(
    () => createTenantScope(inheritedCountry),
    /tenant scope must be an ordinary object/,
  );

  const inheritedSchoolCode = Object.create({ schoolCode: "CD-2026-0001" });
  inheritedSchoolCode.kind = TENANT_SCOPE_KIND.SCHOOL;
  inheritedSchoolCode.countryCode = "CD";
  assert.throws(
    () => createTenantScope(inheritedSchoolCode),
    /tenant scope must be an ordinary object/,
  );

  const hadCountry = Object.hasOwn(Object.prototype, "countryCode");
  const previousCountry = Object.prototype.countryCode;
  Object.prototype.countryCode = "CD";
  try {
    assert.throws(
      () => createTenantScope({ kind: TENANT_SCOPE_KIND.COUNTRY }),
      /countryCode is required as an own property/,
    );
  } finally {
    if (hadCountry) Object.prototype.countryCode = previousCountry;
    else delete Object.prototype.countryCode;
  }

  const hadSchool = Object.hasOwn(Object.prototype, "schoolCode");
  const previousSchool = Object.prototype.schoolCode;
  Object.prototype.schoolCode = "CD-2026-0001";
  try {
    assert.throws(
      () =>
        createTenantScope({
          kind: TENANT_SCOPE_KIND.SCHOOL,
          countryCode: "CD",
        }),
      /schoolCode is required as an own property/,
    );
  } finally {
    if (hadSchool) Object.prototype.schoolCode = previousSchool;
    else delete Object.prototype.schoolCode;
  }
});

test("rejects non-enumerable and Symbol extra own properties on scope", () => {
  const withHiddenField = {
    kind: TENANT_SCOPE_KIND.PLATFORM,
  };
  Object.defineProperty(withHiddenField, "hidden", {
    value: "secret",
    enumerable: false,
  });
  assert.throws(
    () => createTenantScope(withHiddenField),
    /unsupported tenant scope fields: hidden/,
  );

  const withSymbolField = {
    kind: TENANT_SCOPE_KIND.PLATFORM,
  };
  withSymbolField[Symbol("extra")] = "nope";
  assert.throws(() => createTenantScope(withSymbolField), /unsupported tenant scope fields/);
});

test("accepts an exact Object.create(null) school scope", () => {
  const scopeInput = Object.create(null);
  scopeInput.kind = TENANT_SCOPE_KIND.SCHOOL;
  scopeInput.countryCode = "  CD ";
  scopeInput.schoolCode = " CD-2026-0001 ";

  const scope = createTenantScope(scopeInput);
  assert.deepEqual(scope, {
    kind: "school",
    countryCode: "CD",
    schoolCode: "CD-2026-0001",
  });
  assert.equal(Object.isFrozen(scope), true);
});
