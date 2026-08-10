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
