/**
 * Tests du runner E2E runtime — sans Android réel.
 *   node --test Mobile/scripts/verify-mobile-ui-e2e-runtime.test.js
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BLOCKED,
  CANONICAL_PREPROD_API,
  parseAdbDevices,
  selectDevice,
  validateSchoolCode,
  validateApiUrl,
  validateCredentials,
  packageIsInstalled,
  redactSecrets,
  evaluateRuntimeGate,
  executableFlowsFor,
} = require("./lib/e2eRuntimeGate");

const qaEnv = {
  SOMAFRIK_E2E_SCHOOL_CODE: "CD-IN-26-001",
  SOMAFRIK_E2E_IDENTIFIER: "admin-nuru",
  SOMAFRIK_E2E_PASSWORD: "secret-pin",
};

function readyProbes(overrides = {}) {
  return {
    maestroAvailable: true,
    adbAvailable: true,
    adbDevicesOutput: "List of devices attached\nemulator-5554\tdevice\n",
    packagePmOutput: "package:com.somafrik.app\n",
    appLaunchOk: true,
    apiUrl: CANONICAL_PREPROD_API,
    env: qaEnv,
    maestroExecuted: true,
    maestroExitCode: 0,
    ...overrides,
  };
}

test("parseAdbDevices ignore offline/unauthorized", () => {
  const devices = parseAdbDevices(
    "List of devices attached\nemulator-5554\tdevice\ndeadbeef\toffline\n",
  );
  assert.deepEqual(devices, ["emulator-5554"]);
});

test("plusieurs devices sans sélection → fail", () => {
  const selected = selectDevice(["emu-1", "emu-2"], "");
  assert.equal(selected.ok, false);
  assert.equal(selected.code, BLOCKED.MULTIPLE_DEVICES);
});

test("device explicite ANDROID_SERIAL", () => {
  const selected = selectDevice(["emu-1", "emu-2"], "emu-2");
  assert.equal(selected.ok, true);
  assert.equal(selected.device, "emu-2");
});

test("school code SCH-* → fail", () => {
  const result = validateSchoolCode("SCH-ABC123");
  assert.equal(result.ok, false);
  assert.equal(result.code, BLOCKED.SCHOOL_CODE_SCH_ALIAS);
});

test("school code legacy CD-2026-0001 → fail", () => {
  const result = validateSchoolCode("CD-2026-0001");
  assert.equal(result.ok, false);
  assert.equal(result.code, BLOCKED.SCHOOL_CODE_LEGACY);
});

test("login_code V2 accepté", () => {
  const result = validateSchoolCode("CD-IN-26-001");
  assert.equal(result.ok, true);
});

test("API localhost → fail", () => {
  assert.equal(validateApiUrl("http://localhost:5000").code, BLOCKED.API_LOCALHOST);
  assert.equal(validateApiUrl("http://10.0.2.2:5000").code, BLOCKED.API_LOCALHOST);
});

test("API production → fail", () => {
  assert.equal(validateApiUrl("https://api.somafrik.app").code, BLOCKED.API_PRODUCTION);
});

test("credential manquant → fail", () => {
  const result = validateCredentials({ SOMAFRIK_E2E_SCHOOL_CODE: "CD-IN-26-001" });
  assert.equal(result.ok, false);
  assert.equal(result.code, BLOCKED.CREDENTIALS_MISSING);
});

test("Maestro absent → fail", () => {
  const result = evaluateRuntimeGate(readyProbes({ maestroAvailable: false, maestroExecuted: false }));
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, BLOCKED.MAESTRO_MISSING);
});

test("adb absent → fail", () => {
  const result = evaluateRuntimeGate(readyProbes({ adbAvailable: false, maestroExecuted: false }));
  assert.ok(result.failures.some((item) => item.code === BLOCKED.ADB_MISSING));
});

test("aucun device → fail", () => {
  const result = evaluateRuntimeGate(
    readyProbes({ adbDevicesOutput: "List of devices attached\n", maestroExecuted: false }),
  );
  assert.ok(result.failures.some((item) => item.code === BLOCKED.NO_DEVICE));
});

test("package absent → fail", () => {
  const result = evaluateRuntimeGate(readyProbes({ packagePmOutput: "", maestroExecuted: false }));
  assert.ok(result.failures.some((item) => item.code === BLOCKED.PACKAGE_MISSING));
});

test("Maestro status 1 → fail", () => {
  const result = evaluateRuntimeGate(readyProbes({ maestroExitCode: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, BLOCKED.MAESTRO_FAILED);
});

test("préflight OK sans exécuter Maestro → FAIL, jamais SUCCESS", () => {
  const result = evaluateRuntimeGate(readyProbes({ maestroExecuted: false, maestroExitCode: null }));
  assert.equal(result.ok, false);
  assert.notEqual(result.outcome, "SUCCESS");
  assert.equal(result.failures[0].code, BLOCKED.MAESTRO_NOT_EXECUTED);
});

test("Maestro status 0 + vraie exécution → success", () => {
  const result = evaluateRuntimeGate(readyProbes());
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "SUCCESS");
  assert.equal(result.maestroExecuted, true);
  assert.ok(packageIsInstalled("package:com.somafrik.app"));
});

test("secrets jamais recopiés en clair", () => {
  const redacted = redactSecrets("login secret-pin failed", ["secret-pin"]);
  assert.equal(redacted.includes("secret-pin"), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test("09 n'est pas un flow exécutable GO", () => {
  const flows = executableFlowsFor(qaEnv);
  assert.equal(flows.includes("09-partial-domain-error.yaml"), false);
  assert.ok(flows.includes("01-login-admin-school.yaml"));
});

test("plusieurs devices via le gate → fail", () => {
  const result = evaluateRuntimeGate(
    readyProbes({
      adbDevicesOutput: "List of devices attached\nemu-1\tdevice\nemu-2\tdevice\n",
      maestroExecuted: false,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.code === BLOCKED.MULTIPLE_DEVICES));
});

test("API localhost via le gate → fail", () => {
  const result = evaluateRuntimeGate(readyProbes({ apiUrl: "http://127.0.0.1:5000", maestroExecuted: false }));
  assert.ok(result.failures.some((item) => item.code === BLOCKED.API_LOCALHOST));
});

test("API production via le gate → fail", () => {
  const result = evaluateRuntimeGate(readyProbes({ apiUrl: "https://api.somafrik.app", maestroExecuted: false }));
  assert.ok(result.failures.some((item) => item.code === BLOCKED.API_PRODUCTION));
});

test("préflight requireMaestroExecution=false n'est pas SUCCESS", () => {
  const result = evaluateRuntimeGate(readyProbes({ maestroExecuted: false, requireMaestroExecution: false }));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "PREFLIGHT");
  assert.notEqual(result.status, "SUCCESS");
});

test("SOMAFRIK_RUN_MAESTRO n'ouvre pas un SUCCESS", () => {
  const result = evaluateRuntimeGate(
    readyProbes({
      maestroExecuted: false,
      env: { ...qaEnv, SOMAFRIK_RUN_MAESTRO: "1" },
    }),
  );
  assert.equal(result.ok, false);
  assert.notEqual(result.outcome, "SUCCESS");
  assert.equal(result.failures[0].code, BLOCKED.MAESTRO_NOT_EXECUTED);
});
