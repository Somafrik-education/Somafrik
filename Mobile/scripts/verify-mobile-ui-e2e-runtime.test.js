/**
 * Tests du runner E2E runtime — sans Android réel.
 *   node --test Mobile/scripts/verify-mobile-ui-e2e-runtime.test.js
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  BLOCKED,
  CANONICAL_PREPROD_API,
  parseAdbDevices,
  selectDevice,
  validateSchoolCode,
  validateApiUrl,
  validateCredentials,
  validateApkArtifact,
  parseApkPackageName,
  packageIsInstalled,
  redactSecrets,
  publishRedactedExternalText,
  evaluateRuntimeGate,
  executableFlowsFor,
  mutationCoverageReport,
  blockedFlowReport,
} = require("./lib/e2eRuntimeGate");
const { ARTIFACTS } = require("./verify-mobile-ui-e2e-runtime");

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
    apiUrl: "",
    env: qaEnv,
    apkPath: "/tmp/somafrik-qa.apk",
    apkExists: true,
    sha256: "a".repeat(64),
    inspectorAvailable: true,
    badgingOutput: "package: name='com.somafrik.app'\n",
    apkText: "https://somafrik-api-preprod.onrender.com",
    apkInstallOk: true,
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
  assert.equal(validateApiUrl(CANONICAL_PREPROD_API).ok, true);
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

test("API env vide n'est pas considérée comme préprod prouvée", () => {
  const validated = validateApiUrl("");
  assert.equal(validated.ok, true);
  assert.equal(validated.apiUrl, null);
  assert.equal(validated.provenance, "ui");
  const result = evaluateRuntimeGate(readyProbes({ apiUrl: "" }));
  assert.equal(result.apiUrl, null);
  assert.equal(result.apiProvenance, "ui");
});

test("APK path manquant → fail", () => {
  const result = evaluateRuntimeGate(readyProbes({ apkPath: "", maestroExecuted: false }));
  assert.ok(result.failures.some((item) => item.code === BLOCKED.APK_PATH_MISSING));
});

test("APK package mismatch → fail", () => {
  const result = validateApkArtifact({
    apkPath: "/tmp/other.apk",
    apkExists: true,
    sha256: "b".repeat(64),
    inspectorAvailable: true,
    badgingOutput: "package: name='com.other.app'",
    installOk: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, BLOCKED.APK_PACKAGE_MISMATCH);
});

test("aapt absent + chaîne com.somafrik.app dans APK → BLOCKED_APK_PACKAGE_INSPECTOR_MISSING", () => {
  const result = evaluateRuntimeGate(
    readyProbes({
      inspectorAvailable: false,
      badgingOutput: "",
      apkText: "PK zip payload com.somafrik.app https://somafrik-api-preprod.onrender.com",
      apkInstallOk: true,
      maestroExecuted: false,
      requireMaestroExecution: false,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.code === BLOCKED.APK_PACKAGE_INSPECTOR_MISSING));
  assert.notEqual(result.outcome, "SUCCESS");
});

test("badging com.other.app → BLOCKED_APK_PACKAGE_MISMATCH", () => {
  const result = evaluateRuntimeGate(
    readyProbes({
      badgingOutput: "package: name='com.other.app'\n",
      apkText: "com.somafrik.app",
      maestroExecuted: false,
      requireMaestroExecution: false,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.code === BLOCKED.APK_PACKAGE_MISMATCH));
});

test("badging com.somafrik.app + install OK → PASS preflight", () => {
  const result = evaluateRuntimeGate(
    readyProbes({
      maestroExecuted: false,
      requireMaestroExecution: false,
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "PREFLIGHT");
  assert.notEqual(result.status, "SUCCESS");
});

test("ancienne app présente + mauvaise APK → impossible de faux-passer", () => {
  const result = evaluateRuntimeGate(
    readyProbes({
      badgingOutput: "package: name='com.other.app'\n",
      apkText: "com.somafrik.app",
      packagePmOutput: "package:com.somafrik.app\n",
      apkInstallOk: true,
      maestroExecuted: true,
      maestroExitCode: 0,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.code === BLOCKED.APK_PACKAGE_MISMATCH));
  assert.notEqual(result.outcome, "SUCCESS");
});

test("scan ASCII n'identifie pas le package", () => {
  assert.equal(parseApkPackageName("PK zip com.somafrik.app\nlocalhost"), null);
  assert.equal(parseApkPackageName("package: name='com.somafrik.app'"), "com.somafrik.app");
});

test("07/08 sont exécutés en lecture, mutation 12 BLOCKED sans fixture QA", () => {
  const mutation = mutationCoverageReport(qaEnv);
  assert.equal(mutation[0].executed, true);
  assert.equal(mutation[0].flowExecution, "READ");
  assert.equal(mutation[1].file, "12-attendance-mutation.yaml");
  assert.equal(mutation[1].executed, false);
  assert.equal(mutation[1].mutationCoverage, BLOCKED.ATTENDANCE_MUTATION);
  const blocked = blockedFlowReport(qaEnv);
  assert.equal(blocked.some((item) => item.file === "07-attendance.yaml"), false);
  assert.equal(blocked.some((item) => item.file === "08-notes.yaml"), false);
  assert.equal(blocked.some((item) => item.file === "12-attendance-mutation.yaml"), true);
  assert.equal(executableFlowsFor(qaEnv).includes("12-attendance-mutation.yaml"), false);
});

test("fixture QA-APPEL débloque 12 en MUTATION, jamais un skip-vert", () => {
  const env = {
    ...qaEnv,
    SOMAFRIK_E2E_ATTENDANCE_CLASS: "QA-APPEL-6A",
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_A: "QA-ATT-A1",
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_B: "QA-ATT-B1",
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_C: "QA-ATT-C1",
    SOMAFRIK_E2E_ATTENDANCE_STUDENT_D: "QA-ATT-D1",
  };
  const mutation = mutationCoverageReport(env);
  assert.equal(mutation[1].flowExecution, "MUTATION");
  assert.equal(mutation[1].mutationCoverage, "MUTATION_READY");
  assert.equal(mutation[1].executed, true);
  assert.equal(executableFlowsFor(env).includes("12-attendance-mutation.yaml"), true);
  assert.equal(blockedFlowReport(env).some((item) => item.file === "12-attendance-mutation.yaml"), false);
});

test("JUnit contenant SOMAFRIK_E2E_PASSWORD → report.xml final ne contient pas le secret", () => {
  const uploaded = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-uploaded-"));
  const source = path.join(os.tmpdir(), `somafrik-raw-password-${process.pid}.xml`);
  const dest = path.join(uploaded, "report.xml");
  fs.writeFileSync(
    source,
    `<?xml version="1.0"?><testcase name="login"><system-out>inputText ${qaEnv.SOMAFRIK_E2E_PASSWORD}</system-out></testcase>`,
  );
  publishRedactedExternalText({
    sourcePath: source,
    destPath: dest,
    uploadedRoot: uploaded,
    secrets: [qaEnv.SOMAFRIK_E2E_PASSWORD, qaEnv.SOMAFRIK_E2E_IDENTIFIER],
  });
  const final = fs.readFileSync(dest, "utf8");
  assert.equal(final.includes(qaEnv.SOMAFRIK_E2E_PASSWORD), false);
  assert.match(final, /\[REDACTED\]/);
  fs.rmSync(uploaded, { recursive: true, force: true });
});

test("JUnit contenant SOMAFRIK_E2E_IDENTIFIER → valeur remplacée par [REDACTED]", () => {
  const uploaded = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-uploaded-"));
  const source = path.join(os.tmpdir(), `somafrik-raw-identifier-${process.pid}.xml`);
  const dest = path.join(uploaded, "report.xml");
  fs.writeFileSync(
    source,
    `<?xml version="1.0"?><failure message="inputText ${qaEnv.SOMAFRIK_E2E_IDENTIFIER}"/>`,
  );
  publishRedactedExternalText({
    sourcePath: source,
    destPath: dest,
    uploadedRoot: uploaded,
    secrets: [qaEnv.SOMAFRIK_E2E_PASSWORD, qaEnv.SOMAFRIK_E2E_IDENTIFIER],
  });
  const final = fs.readFileSync(dest, "utf8");
  assert.equal(final.includes(qaEnv.SOMAFRIK_E2E_IDENTIFIER), false);
  assert.match(final, /\[REDACTED\]/);
  fs.rmSync(uploaded, { recursive: true, force: true });
});

test("rapport raw → jamais écrit sous Mobile/artifacts/maestro/", () => {
  assert.throws(
    () => publishRedactedExternalText({
      sourcePath: path.join(ARTIFACTS, "report.xml"),
      destPath: path.join(ARTIFACTS, "report.xml"),
      uploadedRoot: ARTIFACTS,
      secrets: [qaEnv.SOMAFRIK_E2E_PASSWORD],
    }),
    /raw/,
  );

  const uploaded = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-uploaded-"));
  const source = path.join(os.tmpdir(), `somafrik-raw-location-${process.pid}.xml`);
  const dest = path.join(uploaded, "report.xml");
  fs.writeFileSync(source, `secret ${qaEnv.SOMAFRIK_E2E_PASSWORD}`);
  publishRedactedExternalText({
    sourcePath: source,
    destPath: dest,
    uploadedRoot: uploaded,
    secrets: [qaEnv.SOMAFRIK_E2E_PASSWORD],
  });
  assert.equal(fs.existsSync(source), false);
  assert.equal(path.resolve(dest).startsWith(path.resolve(uploaded)), true);
  assert.equal(path.resolve(source).startsWith(path.resolve(ARTIFACTS)), false);
  fs.rmSync(uploaded, { recursive: true, force: true });
});

test("failure Maestro → rapport final redacted avant exit", () => {
  const uploaded = fs.mkdtempSync(path.join(os.tmpdir(), "somafrik-uploaded-"));
  const source = path.join(os.tmpdir(), `somafrik-raw-fail-${process.pid}.xml`);
  const dest = path.join(uploaded, "report.xml");
  fs.writeFileSync(
    source,
    `<?xml version="1.0"?><testsuite failures="1"><testcase name="login"><failure>inputText ${qaEnv.SOMAFRIK_E2E_PASSWORD} identifier=${qaEnv.SOMAFRIK_E2E_IDENTIFIER}</failure></testcase></testsuite>`,
  );
  const maestroExitCode = 1;
  publishRedactedExternalText({
    sourcePath: source,
    destPath: dest,
    uploadedRoot: uploaded,
    secrets: [qaEnv.SOMAFRIK_E2E_PASSWORD, qaEnv.SOMAFRIK_E2E_IDENTIFIER],
  });
  assert.equal(maestroExitCode, 1);
  assert.equal(fs.existsSync(source), false);
  const final = fs.readFileSync(dest, "utf8");
  assert.equal(final.includes(qaEnv.SOMAFRIK_E2E_PASSWORD), false);
  assert.equal(final.includes(qaEnv.SOMAFRIK_E2E_IDENTIFIER), false);
  assert.match(final, /\[REDACTED\]/);
  fs.rmSync(uploaded, { recursive: true, force: true });
});
