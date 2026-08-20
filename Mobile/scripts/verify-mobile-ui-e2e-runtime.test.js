"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ALL_FLOWS,
  LIVE_FLOWS,
  FAULT_FLOWS,
  MUTATION_PRECONDITION_FLOW,
  MUTATION_FLOWS,
  MUTATION_CLEANUP_FLOW,
  flowEnvPairs,
  flowsForMode,
  parseAdbDevices,
  redact,
  slugifyAttendanceStatus,
  validateRuntimeConfig,
} = require("./verify-mobile-ui-e2e-runtime");

const LIVE_ENV = {
  SOMAFRIK_E2E_MODE: "live",
  SOMAFRIK_E2E_API_URL: "https://somafrik-api-preprod.onrender.com",
  SOMAFRIK_E2E_SCHOOL_CODE: "BI-EC-26-001",
  SOMAFRIK_E2E_SCHOOL_NAME: "ÉCOLE CANONIQUE QA",
  SOMAFRIK_E2E_ADMIN_IDENTIFIER: "qa-admin@example.test",
  SOMAFRIK_E2E_ADMIN_PASSWORD: "secret-value",
  SOMAFRIK_E2E_EXPECTED_USERS: "4",
  SOMAFRIK_E2E_EXPECTED_PRESENCE: "75%",
  SOMAFRIK_E2E_EXPECTED_PAYMENTS: "25%",
  SOMAFRIK_E2E_CLASS_NAME: "2ème A",
  SOMAFRIK_E2E_STUDENT_NAME: "Esther QA",
  SOMAFRIK_E2E_TEACHER_NAME: "Seke QA",
  SOMAFRIK_E2E_PAYMENT_REFERENCE: "PAY-0004",
  SOMAFRIK_E2E_EVALUATION_LABEL: "Interrogation QA",
};

const FAULT_ENV = {
  SOMAFRIK_E2E_MODE: "fault",
  SOMAFRIK_E2E_API_URL: "http://10.0.2.2:5055",
  SOMAFRIK_E2E_PROBE_URL: "http://127.0.0.1:5055",
  SOMAFRIK_E2E_SCHOOL_CODE: "BI-EC-26-001",
  SOMAFRIK_E2E_SCHOOL_NAME: "ÉCOLE CANONIQUE QA",
  SOMAFRIK_E2E_ADMIN_IDENTIFIER: "qa-admin@example.test",
  SOMAFRIK_E2E_ADMIN_PASSWORD: "secret-value",
  SOMAFRIK_E2E_EXPECTED_PRESENCE: "75%",
  SOMAFRIK_E2E_EXPECTED_PAYMENTS: "25%",
};

const MUTATION_ENV = {
  SOMAFRIK_E2E_MODE: "mutation",
  SOMAFRIK_E2E_API_URL: "https://somafrik-api-preprod.onrender.com",
  SOMAFRIK_E2E_SCHOOL_CODE: "BI-EC-26-001",
  SOMAFRIK_E2E_SCHOOL_NAME: "ÉCOLE CANONIQUE QA",
  SOMAFRIK_E2E_ADMIN_IDENTIFIER: "qa-admin@example.test",
  SOMAFRIK_E2E_ADMIN_PASSWORD: "secret-value",
  SOMAFRIK_E2E_CLASS_NAME: "2ème A",
  SOMAFRIK_E2E_STUDENT_NAME: "Esther QA",
  SOMAFRIK_E2E_STUDENT_ID: "student-qa-1",
  SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_STATUS: "Présent",
  SOMAFRIK_E2E_TARGET_ATTENDANCE_STATUS: "Absent",
  SOMAFRIK_E2E_ALLOW_MUTATIONS: "1",
};

test("runtime contract keeps read-only/fault flows and separates mutation lifecycle", () => {
  assert.deepEqual(ALL_FLOWS, [
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
  assert.equal(LIVE_FLOWS.length, 9);
  assert.deepEqual(FAULT_FLOWS, ["09-partial-domain-error.yaml"]);
  assert.equal(MUTATION_PRECONDITION_FLOW, "11-attendance-precondition.yaml");
  assert.deepEqual(MUTATION_FLOWS, ["12-attendance-persistence.yaml"]);
  assert.equal(MUTATION_CLEANUP_FLOW, "13-attendance-restore.yaml");
  assert.deepEqual([...LIVE_FLOWS, ...FAULT_FLOWS].sort(), [...ALL_FLOWS].sort());
});

test("live runtime accepts preview API + public V2 school code", () => {
  const config = validateRuntimeConfig(LIVE_ENV);
  assert.equal(config.mode, "live");
  assert.equal(config.apiUrl, "https://somafrik-api-preprod.onrender.com");
  assert.equal(config.probeUrl, config.apiUrl);
  assert.equal(config.schoolCode, "BI-EC-26-001");
  assert.equal(config.envBadge, "Preview QA");
  assert.equal(config.expectedUsers, "4");
});

test("fault runtime uses emulator host proxy and development badge", () => {
  const config = validateRuntimeConfig(FAULT_ENV);
  assert.equal(config.mode, "fault");
  assert.equal(config.apiUrl, "http://10.0.2.2:5055");
  assert.equal(config.probeUrl, "http://127.0.0.1:5055");
  assert.equal(config.envBadge, "Développement");
  assert.deepEqual(flowsForMode("fault"), FAULT_FLOWS);
  assert.deepEqual(flowsForMode("live"), LIVE_FLOWS);
});

test("mutation runtime is preview-only, explicit, reversible and derives action slugs", () => {
  const config = validateRuntimeConfig(MUTATION_ENV);
  assert.equal(config.mode, "mutation");
  assert.equal(config.apiUrl, "https://somafrik-api-preprod.onrender.com");
  assert.equal(config.mutationsAllowed, true);
  assert.equal(config.originalAttendanceStatus, "Présent");
  assert.equal(config.originalAttendanceSlug, "present");
  assert.equal(config.targetAttendanceStatus, "Absent");
  assert.equal(config.targetAttendanceSlug, "absent");
  assert.deepEqual(flowsForMode("mutation"), MUTATION_FLOWS);
});

test("mutation runtime requires explicit opt-in", () => {
  const env = { ...MUTATION_ENV };
  delete env.SOMAFRIK_E2E_ALLOW_MUTATIONS;
  assert.throws(() => validateRuntimeConfig(env), /ALLOW_MUTATIONS=1/);
});

test("mutation runtime refuses protected Nuru tenant by default", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...MUTATION_ENV, SOMAFRIK_E2E_SCHOOL_CODE: "CD-IN-26-001" }),
    /Mutations E2E interdites/,
  );
});

test("mutation runtime validates attendance statuses and requires a real transition", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...MUTATION_ENV, SOMAFRIK_E2E_TARGET_ATTENDANCE_STATUS: "Inconnu" }),
    /TARGET_ATTENDANCE_STATUS invalide/,
  );
  assert.throws(
    () => validateRuntimeConfig({ ...MUTATION_ENV, SOMAFRIK_E2E_TARGET_ATTENDANCE_STATUS: "Présent" }),
    /différent du statut initial/,
  );
  assert.equal(slugifyAttendanceStatus("Justifié"), "justifie");
});

test("live runtime rejects production API", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...LIVE_ENV, SOMAFRIK_E2E_API_URL: "https://api.somafrik.app" }),
    /Preview doit cibler uniquement/,
  );
});

test("mutation runtime also rejects production API", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...MUTATION_ENV, SOMAFRIK_E2E_API_URL: "https://api.somafrik.app" }),
    /Preview doit cibler uniquement/,
  );
});

test("fault runtime rejects arbitrary remote proxy", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...FAULT_ENV, SOMAFRIK_E2E_API_URL: "http://example.test:5055" }),
    /10\.0\.2\.2/,
  );
});

test("runtime rejects internal SCH alias and legacy school code", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...LIVE_ENV, SOMAFRIK_E2E_SCHOOL_CODE: "SCH-ABC123" }),
    /login_code V2 public/,
  );
  assert.throws(
    () => validateRuntimeConfig({ ...LIVE_ENV, SOMAFRIK_E2E_SCHOOL_CODE: "CD-2026-0001" }),
    /login_code V2 public/,
  );
});

test("live runtime is fail-closed when fixture expectations are missing", () => {
  const withoutTeacher = { ...LIVE_ENV };
  delete withoutTeacher.SOMAFRIK_E2E_TEACHER_NAME;
  assert.throws(() => validateRuntimeConfig(withoutTeacher), /SOMAFRIK_E2E_TEACHER_NAME est obligatoire/);
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
  const config = validateRuntimeConfig(LIVE_ENV);
  const output = redact(
    `identifier=${LIVE_ENV.SOMAFRIK_E2E_ADMIN_IDENTIFIER} password=${LIVE_ENV.SOMAFRIK_E2E_ADMIN_PASSWORD}`,
    config,
  );
  assert.doesNotMatch(output, /qa-admin@example\.test/);
  assert.doesNotMatch(output, /secret-value/);
  assert.equal((output.match(/\[REDACTED\]/g) || []).length, 2);
});

test("Maestro env payload contains deterministic fixture values", () => {
  const pairs = new Map(flowEnvPairs(validateRuntimeConfig(LIVE_ENV)));
  assert.equal(pairs.get("SOMAFRIK_E2E_ENV_BADGE"), "Preview QA");
  assert.equal(pairs.get("SOMAFRIK_E2E_SCHOOL_CODE"), "BI-EC-26-001");
  assert.equal(pairs.get("SOMAFRIK_E2E_ADMIN_IDENTIFIER"), "qa-admin@example.test");
  assert.equal(pairs.get("SOMAFRIK_E2E_ADMIN_PASSWORD"), "secret-value");
  assert.equal(pairs.get("SOMAFRIK_E2E_CLASS_NAME"), "2ème A");
  assert.equal(pairs.get("SOMAFRIK_E2E_PAYMENT_REFERENCE"), "PAY-0004");
});

test("mutation env payload includes exact IDs/statuses used by Maestro cleanup", () => {
  const pairs = new Map(flowEnvPairs(validateRuntimeConfig(MUTATION_ENV)));
  assert.equal(pairs.get("SOMAFRIK_E2E_STUDENT_ID"), "student-qa-1");
  assert.equal(pairs.get("SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_STATUS"), "Présent");
  assert.equal(pairs.get("SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_SLUG"), "present");
  assert.equal(pairs.get("SOMAFRIK_E2E_TARGET_ATTENDANCE_STATUS"), "Absent");
  assert.equal(pairs.get("SOMAFRIK_E2E_TARGET_ATTENDANCE_SLUG"), "absent");
});
