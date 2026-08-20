"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REQUIRED_FLOWS,
  flowEnvPairs,
  parseAdbDevices,
  redact,
  validateRuntimeConfig,
} = require("./verify-mobile-ui-e2e-runtime");

const BASE_ENV = {
  SOMAFRIK_E2E_API_URL: "https://somafrik-api-preprod.onrender.com",
  SOMAFRIK_E2E_SCHOOL_CODE: "BI-EC-26-001",
  SOMAFRIK_E2E_ADMIN_IDENTIFIER: "qa-admin@example.test",
  SOMAFRIK_E2E_ADMIN_PASSWORD: "secret-value",
};

test("runtime requires exactly the 10 audited black-box flows", () => {
  assert.deepEqual(REQUIRED_FLOWS, [
    "01-login-admin-school.yaml",
    "02-home-metrics.yaml",
    "03-users-matches-home.yaml",
    "04-classes-presence.yaml",
    "05-payments.yaml",
    "06-teachers.yaml",
    "07-attendance.yaml",
    "08-notes.yaml",
    "09-partial-domain-error.yaml",
    "10-relaunch-no-catalog.yaml",
  ]);
});

test("runtime accepts preview API + public V2 school code", () => {
  const config = validateRuntimeConfig(BASE_ENV);
  assert.equal(config.apiUrl, "https://somafrik-api-preprod.onrender.com");
  assert.equal(config.schoolCode, "BI-EC-26-001");
  assert.equal(config.mutationEnabled, false);
});

test("runtime rejects production API", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...BASE_ENV, SOMAFRIK_E2E_API_URL: "https://api.somafrik.app" }),
    /Preview doit cibler uniquement/,
  );
});

test("runtime rejects internal SCH alias and legacy school code", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...BASE_ENV, SOMAFRIK_E2E_SCHOOL_CODE: "SCH-ABC123" }),
    /login_code V2 public/,
  );
  assert.throws(
    () => validateRuntimeConfig({ ...BASE_ENV, SOMAFRIK_E2E_SCHOOL_CODE: "CD-2026-0001" }),
    /login_code V2 public/,
  );
});

test("mutation mode requires double opt-in and refuses protected Nuru code", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...BASE_ENV, SOMAFRIK_E2E_MUTATIONS: "1" }),
    /ALLOW_MUTATIONS=1/,
  );
  assert.throws(
    () =>
      validateRuntimeConfig({
        ...BASE_ENV,
        SOMAFRIK_E2E_SCHOOL_CODE: "CD-IN-26-001",
        SOMAFRIK_E2E_MUTATIONS: "1",
        SOMAFRIK_E2E_ALLOW_MUTATIONS: "1",
      }),
    /Mutations E2E interdites/,
  );
});

test("adb parser returns only online device rows", () => {
  const output = [
    "List of devices attached",
    "emulator-5554\tdevice",
    "ABCDEF\toffline",
    "ZXCVBN\tunauthorized",
    "",
  ].join("\n");
  assert.deepEqual(parseAdbDevices(output), ["emulator-5554"]);
});

test("secret values are redacted from captured Maestro logs", () => {
  const config = validateRuntimeConfig(BASE_ENV);
  const output = redact(
    `identifier=${BASE_ENV.SOMAFRIK_E2E_ADMIN_IDENTIFIER} password=${BASE_ENV.SOMAFRIK_E2E_ADMIN_PASSWORD}`,
    config,
  );
  assert.doesNotMatch(output, /qa-admin@example\.test/);
  assert.doesNotMatch(output, /secret-value/);
  assert.equal((output.match(/\[REDACTED\]/g) || []).length, 2);
});

test("Maestro env payload never drops required credentials", () => {
  const pairs = new Map(flowEnvPairs(validateRuntimeConfig(BASE_ENV)));
  assert.equal(pairs.get("SOMAFRIK_E2E_SCHOOL_CODE"), "BI-EC-26-001");
  assert.equal(pairs.get("SOMAFRIK_E2E_ADMIN_IDENTIFIER"), "qa-admin@example.test");
  assert.equal(pairs.get("SOMAFRIK_E2E_ADMIN_PASSWORD"), "secret-value");
});
