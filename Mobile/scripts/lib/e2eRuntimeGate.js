/**
 * LOT 8 — contrat runtime E2E (preuve black-box). Logique pure, injectable.
 * Jamais SUCCESS si Maestro / adb / device / package / credentials manquent.
 */
"use strict";

const ANDROID_PACKAGE = "com.somafrik.app";
const CANONICAL_PREPROD_API = "https://somafrik-api-preprod.onrender.com";
const EXPECTED_SCHOOL_CODE = "CD-IN-26-001";
const V2_SCHOOL_LOGIN_PATTERN = /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2}-\d{3}$/;
const LEGACY_SCHOOL_CODE_PATTERN = /^[A-Z]{2}-\d{4}-\d{4}$/;
const INTERNAL_SCHOOL_ALIAS_PATTERN = /^SCH-[A-Z0-9]+$/;

const BLOCKED = Object.freeze({
  MAESTRO_MISSING: "BLOCKED_MAESTRO_MISSING",
  ADB_MISSING: "BLOCKED_ADB_MISSING",
  NO_DEVICE: "BLOCKED_NO_DEVICE",
  MULTIPLE_DEVICES: "BLOCKED_MULTIPLE_DEVICES_NO_SELECTION",
  PACKAGE_MISSING: "BLOCKED_PACKAGE_NOT_INSTALLED",
  APP_LAUNCH_FAILED: "BLOCKED_APP_LAUNCH_FAILED",
  API_LOCALHOST: "BLOCKED_API_LOCALHOST",
  API_PRODUCTION: "BLOCKED_API_PRODUCTION",
  API_NOT_PREPROD: "BLOCKED_API_NOT_PREPROD",
  CREDENTIALS_MISSING: "BLOCKED_CREDENTIALS_MISSING",
  SCHOOL_CODE_SCH_ALIAS: "BLOCKED_SCHOOL_CODE_SCH_ALIAS",
  SCHOOL_CODE_LEGACY: "BLOCKED_SCHOOL_CODE_LEGACY",
  SCHOOL_CODE_INVALID: "BLOCKED_SCHOOL_CODE_INVALID",
  MAESTRO_FAILED: "BLOCKED_MAESTRO_FAILED",
  MAESTRO_NOT_EXECUTED: "BLOCKED_MAESTRO_NOT_EXECUTED",
  NO_FAILURE_INJECTION: "BLOCKED_NO_FAILURE_INJECTION",
  NO_PLATFORM_QA: "BLOCKED_NO_PLATFORM_QA_CREDENTIALS",
  ATTENDANCE_MUTATION: "MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE",
  NOTES_MUTATION: "MUTATION_NOTES_BLOCKED_NO_QA_FIXTURE",
  EAS_AUTH: "BLOCKED_EAS_AUTH",
  APK_FORBIDDEN_HOST: "BLOCKED_APK_FORBIDDEN_HOST",
});

const EXECUTABLE_FLOWS = Object.freeze([
  "01-login-admin-school.yaml",
  "02-home-metrics.yaml",
  "03-users-matches-home.yaml",
  "04-classes-presence.yaml",
  "05-payments.yaml",
  "06-teachers.yaml",
  "07-attendance.yaml",
  "08-notes.yaml",
  "10-relaunch-no-catalog.yaml",
]);

const BLOCKED_FLOWS = Object.freeze([
  {
    file: "09-partial-domain-error.yaml",
    code: BLOCKED.NO_FAILURE_INJECTION,
    reason: "Pas d'injection de panne réseau contrôlée. Contrat couvert par les tests unitaires Data Truth.",
  },
]);

function asTrimmed(value) {
  return String(value ?? "").trim();
}

function normalizeApiUrl(value) {
  return asTrimmed(value).replace(/\/+$/, "");
}

function parseAdbDevices(stdout) {
  const devices = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^list of devices/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[1] === "device") {
      devices.push(parts[0]);
    }
  }
  return devices;
}

function selectDevice(devices, selectedSerial) {
  const list = Array.isArray(devices) ? devices.filter(Boolean) : [];
  const serial = asTrimmed(selectedSerial);
  if (serial) {
    if (!list.includes(serial)) {
      return {
        ok: false,
        code: BLOCKED.NO_DEVICE,
        message: `Aucun appareil Android '${serial}'.`,
      };
    }
    return { ok: true, device: serial };
  }
  if (list.length === 0) {
    return { ok: false, code: BLOCKED.NO_DEVICE, message: "Aucun appareil Android exploitable." };
  }
  if (list.length > 1) {
    return {
      ok: false,
      code: BLOCKED.MULTIPLE_DEVICES,
      message: "Plusieurs appareils Android. Définir ANDROID_SERIAL.",
    };
  }
  return { ok: true, device: list[0] };
}

function validateSchoolCode(code) {
  const normalized = asTrimmed(code).toUpperCase();
  if (!normalized) {
    return { ok: false, code: BLOCKED.CREDENTIALS_MISSING, message: "SOMAFRIK_E2E_SCHOOL_CODE manquant." };
  }
  if (INTERNAL_SCHOOL_ALIAS_PATTERN.test(normalized)) {
    return { ok: false, code: BLOCKED.SCHOOL_CODE_SCH_ALIAS, message: "SCH-* interdit (alias interne)." };
  }
  if (LEGACY_SCHOOL_CODE_PATTERN.test(normalized) || normalized === "CD-2026-0001") {
    return { ok: false, code: BLOCKED.SCHOOL_CODE_LEGACY, message: "Code établissement legacy interdit." };
  }
  if (!V2_SCHOOL_LOGIN_PATTERN.test(normalized)) {
    return { ok: false, code: BLOCKED.SCHOOL_CODE_INVALID, message: "login_code V2 requis (ex. CD-IN-26-001)." };
  }
  return { ok: true, schoolCode: normalized };
}

function validateApiUrl(url) {
  const normalized = normalizeApiUrl(url) || CANONICAL_PREPROD_API;
  if (/localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./i.test(normalized) || /^http:\/\//i.test(normalized)) {
    return { ok: false, code: BLOCKED.API_LOCALHOST, message: `API locale/LAN/HTTP interdite (${normalized}).` };
  }
  if (/api\.somafrik\.app/i.test(normalized)) {
    return { ok: false, code: BLOCKED.API_PRODUCTION, message: "API production interdite pour le LOT 8." };
  }
  if (normalized !== CANONICAL_PREPROD_API) {
    return {
      ok: false,
      code: BLOCKED.API_NOT_PREPROD,
      message: `API préprod canonique exigée: ${CANONICAL_PREPROD_API}.`,
    };
  }
  return { ok: true, apiUrl: normalized };
}

function validateCredentials(env = {}) {
  const school = validateSchoolCode(env.SOMAFRIK_E2E_SCHOOL_CODE);
  if (!school.ok) return school;
  const identifier = asTrimmed(env.SOMAFRIK_E2E_IDENTIFIER);
  const password = asTrimmed(env.SOMAFRIK_E2E_PASSWORD);
  if (!identifier || !password) {
    return {
      ok: false,
      code: BLOCKED.CREDENTIALS_MISSING,
      message: "SOMAFRIK_E2E_IDENTIFIER et SOMAFRIK_E2E_PASSWORD requis via l'environnement.",
    };
  }
  return {
    ok: true,
    schoolCode: school.schoolCode,
    identifier,
  };
}

function hasPlatformCredentials(env = {}) {
  return Boolean(
    asTrimmed(env.SOMAFRIK_E2E_PLATFORM_IDENTIFIER)
      && asTrimmed(env.SOMAFRIK_E2E_PLATFORM_PASSWORD)
      && asTrimmed(env.SOMAFRIK_E2E_SCHOOL_CODE_B),
  );
}

function packageIsInstalled(pmOutput, packageName = ANDROID_PACKAGE) {
  const text = String(pmOutput ?? "");
  return text.includes(`package:${packageName}`) || new RegExp(`\\b${packageName}\\b`).test(text);
}

function scanApkTextForForbiddenHosts(apkText) {
  const text = String(apkText ?? "");
  if (/localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./i.test(text)) {
    return { ok: false, code: BLOCKED.APK_FORBIDDEN_HOST, message: "APK référence localhost/LAN." };
  }
  if (/https:\/\/api\.somafrik\.app/i.test(text) && !/somafrik-api-preprod\.onrender\.com/i.test(text)) {
    return { ok: false, code: BLOCKED.API_PRODUCTION, message: "APK pointe vers l'API production." };
  }
  return { ok: true };
}

function redactSecrets(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of secrets) {
    const value = asTrimmed(secret);
    if (value.length < 2) continue;
    out = out.split(value).join("[REDACTED]");
  }
  return out;
}

function maestroEnvFrom(env = {}) {
  const next = {
    SOMAFRIK_E2E_SCHOOL_CODE: asTrimmed(env.SOMAFRIK_E2E_SCHOOL_CODE).toUpperCase(),
    SOMAFRIK_E2E_IDENTIFIER: asTrimmed(env.SOMAFRIK_E2E_IDENTIFIER),
    SOMAFRIK_E2E_PASSWORD: asTrimmed(env.SOMAFRIK_E2E_PASSWORD),
  };
  if (hasPlatformCredentials(env)) {
    next.SOMAFRIK_E2E_PLATFORM_IDENTIFIER = asTrimmed(env.SOMAFRIK_E2E_PLATFORM_IDENTIFIER);
    next.SOMAFRIK_E2E_PLATFORM_PASSWORD = asTrimmed(env.SOMAFRIK_E2E_PLATFORM_PASSWORD);
    next.SOMAFRIK_E2E_SCHOOL_CODE_B = asTrimmed(env.SOMAFRIK_E2E_SCHOOL_CODE_B).toUpperCase();
  }
  return next;
}

function blockedFlowReport(env = {}) {
  const blocked = BLOCKED_FLOWS.map((item) => ({ ...item, executed: false, outcome: "BLOCKED" }));
  blocked.push({
    file: "07-attendance.yaml",
    code: BLOCKED.ATTENDANCE_MUTATION,
    reason: "Lecture seule. Aucune fixture QA isolée pour muter une présence Nuru.",
    executed: false,
    outcome: "BLOCKED",
  });
  blocked.push({
    file: "08-notes.yaml",
    code: BLOCKED.NOTES_MUTATION,
    reason: "Lecture seule. Aucune fixture QA isolée pour muter une note Nuru.",
    executed: false,
    outcome: "BLOCKED",
  });
  if (!hasPlatformCredentials(env)) {
    blocked.push({
      file: "11-platform-tenant-switch.yaml",
      code: BLOCKED.NO_PLATFORM_QA,
      reason: "Pas de credentials plateforme QA. Preuve backend X-Somafrik-School-Code conservée.",
      executed: false,
      outcome: "BLOCKED",
    });
  }
  return blocked;
}

function executableFlowsFor(env = {}) {
  const flows = [...EXECUTABLE_FLOWS];
  if (hasPlatformCredentials(env)) {
    flows.push("11-platform-tenant-switch.yaml");
  }
  return flows;
}

/**
 * @param {{
 *   maestroAvailable?: boolean,
 *   adbAvailable?: boolean,
 *   adbDevicesOutput?: string,
 *   selectedSerial?: string,
 *   packagePmOutput?: string,
 *   appLaunchOk?: boolean,
 *   apiUrl?: string,
 *   env?: Record<string, string>,
 *   apkText?: string | null,
 *   maestroExecuted?: boolean,
 *   maestroExitCode?: number | null,
 *   requireMaestroExecution?: boolean,
 * }} input
 */
function evaluateRuntimeGate(input = {}) {
  const failures = [];
  const env = input.env || {};
  const requireMaestroExecution = input.requireMaestroExecution !== false;

  if (!input.maestroAvailable) {
    failures.push({ code: BLOCKED.MAESTRO_MISSING, message: "maestro --version a échoué." });
  }
  if (!input.adbAvailable) {
    failures.push({ code: BLOCKED.ADB_MISSING, message: "adb n'est pas disponible." });
  }

  const devices = parseAdbDevices(input.adbDevicesOutput);
  const device = selectDevice(devices, input.selectedSerial);
  if (!device.ok) failures.push({ code: device.code, message: device.message });

  if (!packageIsInstalled(input.packagePmOutput, ANDROID_PACKAGE)) {
    failures.push({
      code: BLOCKED.PACKAGE_MISSING,
      message: `${ANDROID_PACKAGE} n'est pas installé sur l'appareil.`,
    });
  }
  if (input.appLaunchOk === false) {
    failures.push({ code: BLOCKED.APP_LAUNCH_FAILED, message: "Impossible de lancer com.somafrik.app." });
  }

  const api = validateApiUrl(input.apiUrl || env.SOMAFRIK_E2E_API_URL);
  if (!api.ok) failures.push({ code: api.code, message: api.message });

  const credentials = validateCredentials(env);
  if (!credentials.ok) failures.push({ code: credentials.code, message: credentials.message });

  if (input.apkText) {
    const apk = scanApkTextForForbiddenHosts(input.apkText);
    if (!apk.ok) failures.push({ code: apk.code, message: apk.message });
  }

  const blocked = blockedFlowReport(env);
  const executable = executableFlowsFor(env);

  if (failures.length) {
    return {
      ok: false,
      outcome: "FAIL",
      status: "BLOCKED",
      failures,
      blocked,
      executable,
      device: device.ok ? device.device : null,
      apiUrl: api.ok ? api.apiUrl : null,
      maestroExecuted: false,
    };
  }

  if (!requireMaestroExecution) {
    return {
      ok: true,
      outcome: "PREFLIGHT",
      status: "PREFLIGHT_OK",
      failures: [],
      blocked,
      executable,
      device: device.device,
      apiUrl: api.apiUrl,
      maestroExecuted: false,
    };
  }

  if (!input.maestroExecuted) {
    return {
      ok: false,
      outcome: "FAIL",
      status: "BLOCKED",
      failures: [
        {
          code: BLOCKED.MAESTRO_NOT_EXECUTED,
          message: "Maestro n'a pas été exécuté. Absence de runtime ≠ SUCCESS.",
        },
      ],
      blocked,
      executable,
      device: device.device,
      apiUrl: api.apiUrl,
      maestroExecuted: false,
    };
  }

  if (input.maestroExitCode !== 0) {
    return {
      ok: false,
      outcome: "FAIL",
      status: "FAIL",
      failures: [
        {
          code: BLOCKED.MAESTRO_FAILED,
          message: `Maestro a retourné ${input.maestroExitCode}.`,
        },
      ],
      blocked,
      executable,
      device: device.device,
      apiUrl: api.apiUrl,
      maestroExecuted: true,
      maestroExitCode: input.maestroExitCode,
    };
  }

  return {
    ok: true,
    outcome: "SUCCESS",
    status: "SUCCESS",
    failures: [],
    blocked,
    executable,
    device: device.device,
    apiUrl: api.apiUrl,
    maestroExecuted: true,
    maestroExitCode: 0,
  };
}

module.exports = {
  ANDROID_PACKAGE,
  CANONICAL_PREPROD_API,
  EXPECTED_SCHOOL_CODE,
  BLOCKED,
  EXECUTABLE_FLOWS,
  BLOCKED_FLOWS,
  parseAdbDevices,
  selectDevice,
  validateSchoolCode,
  validateApiUrl,
  validateCredentials,
  hasPlatformCredentials,
  packageIsInstalled,
  scanApkTextForForbiddenHosts,
  redactSecrets,
  maestroEnvFrom,
  blockedFlowReport,
  executableFlowsFor,
  evaluateRuntimeGate,
};
