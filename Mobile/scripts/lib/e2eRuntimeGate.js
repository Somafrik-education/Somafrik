/**
 * LOT 8 — contrat runtime E2E (preuve black-box). Logique pure, injectable.
 * Jamais SUCCESS si Maestro / adb / device / package / credentials manquent.
 */
"use strict";

const fs = require("fs");
const path = require("path");

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
  APK_PATH_MISSING: "BLOCKED_APK_PATH_MISSING",
  APK_NOT_FOUND: "BLOCKED_APK_NOT_FOUND",
  APK_HASH_MISSING: "BLOCKED_APK_HASH_MISSING",
  APK_PACKAGE_MISMATCH: "BLOCKED_APK_PACKAGE_MISMATCH",
  APK_PACKAGE_INSPECTOR_MISSING: "BLOCKED_APK_PACKAGE_INSPECTOR_MISSING",
  APK_INSTALL_FAILED: "BLOCKED_APK_INSTALL_FAILED",
});

const EXPECTED_API_STATUS_LABEL = `API : ${CANONICAL_PREPROD_API}/api`;

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
  const normalized = normalizeApiUrl(url);
  if (!normalized) {
    return { ok: true, apiUrl: null, provenance: "ui" };
  }
  if (/localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\./i.test(normalized) || /^http:\/\//i.test(normalized)) {
    return { ok: false, code: BLOCKED.API_LOCALHOST, message: `API locale/LAN/HTTP interdite (${normalized}).` };
  }
  if (/api\.somafrik\.app/i.test(normalized)) {
    return { ok: false, code: BLOCKED.API_PRODUCTION, message: "API production interdite pour le LOT 8." };
  }
  if (normalized !== CANONICAL_PREPROD_API && normalized !== `${CANONICAL_PREPROD_API}/api`) {
    return {
      ok: false,
      code: BLOCKED.API_NOT_PREPROD,
      message: `API préprod canonique exigée: ${CANONICAL_PREPROD_API}.`,
    };
  }
  return { ok: true, apiUrl: CANONICAL_PREPROD_API, provenance: "env" };
}

function parseApkPackageName(badgingOutput) {
  const text = String(badgingOutput || "");
  const named = text.match(/package:\s*name=['"]([^'"]+)['"]/i);
  if (named) return named[1];
  const applicationId = text.match(/application-id[:\s]+([A-Za-z][\w.]*)/i);
  if (applicationId) return applicationId[1];
  const trimmed = text.trim();
  if (/^[A-Za-z][\w.]*\.[A-Za-z][\w.]*$/.test(trimmed)) return trimmed;
  return null;
}

function validateApkArtifact(input = {}) {
  const apkPath = asTrimmed(input.apkPath);
  if (!apkPath) {
    return { ok: false, code: BLOCKED.APK_PATH_MISSING, message: "SOMAFRIK_E2E_APK_PATH obligatoire pour un RUNTIME GO." };
  }
  if (!input.apkExists) {
    return { ok: false, code: BLOCKED.APK_NOT_FOUND, message: `APK introuvable: ${apkPath}` };
  }
  const sha256 = asTrimmed(input.sha256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return { ok: false, code: BLOCKED.APK_HASH_MISSING, message: "SHA256 APK manquant ou invalide." };
  }
  if (input.inspectorAvailable !== true) {
    return {
      ok: false,
      code: BLOCKED.APK_PACKAGE_INSPECTOR_MISSING,
      message: "aapt, aapt2 ou apkanalyzer obligatoire. La chaîne com.somafrik.app dans le ZIP n'est pas une identité.",
    };
  }
  const packageName = parseApkPackageName(input.badgingOutput);
  if (packageName !== ANDROID_PACKAGE) {
    return {
      ok: false,
      code: BLOCKED.APK_PACKAGE_MISMATCH,
      message: `Package APK attendu ${ANDROID_PACKAGE}, obtenu ${packageName || "inconnu"}.`,
    };
  }
  if (input.installOk === false) {
    return { ok: false, code: BLOCKED.APK_INSTALL_FAILED, message: "adb uninstall + adb install de l'APK fournie a échoué." };
  }
  return { ok: true, apkPath, sha256, packageName };
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
    const xmlEscaped = value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
    if (xmlEscaped !== value) {
      out = out.split(xmlEscaped).join("[REDACTED]");
    }
  }
  return out;
}

function isPathInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(prefix);
}

/**
 * Copie un artifact texte d'un outil externe (Maestro, etc.) vers le dossier
 * uploadé, après redaction. Le fichier RAW ne doit jamais vivre sous uploadedRoot.
 */
function publishRedactedExternalText(input = {}) {
  const sourcePath = input.sourcePath;
  const destPath = input.destPath;
  const uploadedRoot = input.uploadedRoot;
  const secrets = input.secrets || [];
  if (!sourcePath || !destPath || !uploadedRoot) {
    throw new Error("publishRedactedExternalText: sourcePath, destPath et uploadedRoot requis.");
  }
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDest = path.resolve(destPath);
  const resolvedRoot = path.resolve(uploadedRoot);

  if (isPathInside(resolvedRoot, resolvedSource)) {
    throw new Error("rapport raw jamais écrit sous Mobile/artifacts/maestro/");
  }
  if (!isPathInside(resolvedRoot, resolvedDest)) {
    throw new Error("artifact final hors du dossier uploadé.");
  }

  let raw = "";
  try {
    if (fs.existsSync(resolvedSource)) {
      raw = fs.readFileSync(resolvedSource, "utf8");
    }
    const redacted = redactSecrets(raw, secrets);
    fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });
    fs.writeFileSync(resolvedDest, redacted);
    return { destPath: resolvedDest, redacted, missingSource: !raw && !fs.existsSync(resolvedSource) };
  } finally {
    try {
      if (fs.existsSync(resolvedSource)) fs.unlinkSync(resolvedSource);
    } catch {
      // best-effort : ne pas laisser un RAW avec secrets
    }
  }
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

function mutationCoverageReport() {
  return [
    {
      file: "07-attendance.yaml",
      flowExecution: "READ",
      mutationCoverage: BLOCKED.ATTENDANCE_MUTATION,
      executed: true,
      reason: "Lecture seule. Aucune fixture QA isolée pour muter une présence Nuru.",
    },
    {
      file: "08-notes.yaml",
      flowExecution: "READ",
      mutationCoverage: BLOCKED.NOTES_MUTATION,
      executed: true,
      reason: "Lecture seule. Aucune fixture QA isolée pour muter une note Nuru.",
    },
  ];
}

function blockedFlowReport(env = {}) {
  const blocked = BLOCKED_FLOWS.map((item) => ({
    ...item,
    executed: false,
    flowExecution: "NOT_EXECUTED",
    outcome: "BLOCKED",
  }));
  if (!hasPlatformCredentials(env)) {
    blocked.push({
      file: "11-platform-tenant-switch.yaml",
      code: BLOCKED.NO_PLATFORM_QA,
      reason: "Pas de credentials plateforme QA. Preuve backend X-Somafrik-School-Code conservée.",
      executed: false,
      flowExecution: "NOT_EXECUTED",
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
 *   apkPath?: string,
 *   apkExists?: boolean,
 *   sha256?: string,
 *   inspectorAvailable?: boolean,
 *   badgingOutput?: string,
 *   apkInstallOk?: boolean,
 *   requireApk?: boolean,
 * }} input
 */
function evaluateRuntimeGate(input = {}) {
  const failures = [];
  const env = input.env || {};
  const requireMaestroExecution = input.requireMaestroExecution !== false;
  const requireApk = input.requireApk !== false;

  if (!input.maestroAvailable) {
    failures.push({ code: BLOCKED.MAESTRO_MISSING, message: "maestro --version a échoué." });
  }
  if (!input.adbAvailable) {
    failures.push({ code: BLOCKED.ADB_MISSING, message: "adb n'est pas disponible." });
  }

  const devices = parseAdbDevices(input.adbDevicesOutput);
  const device = selectDevice(devices, input.selectedSerial);
  if (!device.ok) failures.push({ code: device.code, message: device.message });

  const apk = requireApk
    ? validateApkArtifact({
      apkPath: input.apkPath || env.SOMAFRIK_E2E_APK_PATH,
      apkExists: input.apkExists,
      sha256: input.sha256,
      inspectorAvailable: input.inspectorAvailable,
      badgingOutput: input.badgingOutput,
      installOk: input.apkInstallOk,
    })
    : { ok: true, apkPath: null, sha256: null, packageName: null };
  if (!apk.ok) failures.push({ code: apk.code, message: apk.message });

  if (!packageIsInstalled(input.packagePmOutput, ANDROID_PACKAGE)) {
    failures.push({
      code: BLOCKED.PACKAGE_MISSING,
      message: `${ANDROID_PACKAGE} n'est pas installé sur l'appareil.`,
    });
  }
  if (input.appLaunchOk === false) {
    failures.push({ code: BLOCKED.APP_LAUNCH_FAILED, message: "Impossible de lancer com.somafrik.app." });
  }

  const api = validateApiUrl(input.apiUrl !== undefined ? input.apiUrl : env.SOMAFRIK_E2E_API_URL);
  if (!api.ok) failures.push({ code: api.code, message: api.message });

  const credentials = validateCredentials(env);
  if (!credentials.ok) failures.push({ code: credentials.code, message: credentials.message });

  if (input.apkText) {
    const apkHosts = scanApkTextForForbiddenHosts(input.apkText);
    if (!apkHosts.ok) failures.push({ code: apkHosts.code, message: apkHosts.message });
  }

  const blocked = blockedFlowReport(env);
  const mutationCoverage = mutationCoverageReport();
  const executable = executableFlowsFor(env);

  const base = {
    blocked,
    mutationCoverage,
    executable,
    device: device.ok ? device.device : null,
    apiUrl: api.ok ? api.apiUrl : null,
    apiProvenance: api.ok ? api.provenance : null,
    apkPath: apk.ok ? apk.apkPath : null,
    apkSha256: apk.ok ? apk.sha256 : null,
  };

  if (failures.length) {
    return {
      ok: false,
      outcome: "FAIL",
      status: "BLOCKED",
      failures,
      maestroExecuted: false,
      ...base,
    };
  }

  if (!requireMaestroExecution) {
    return {
      ok: true,
      outcome: "PREFLIGHT",
      status: "PREFLIGHT_OK",
      failures: [],
      maestroExecuted: false,
      ...base,
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
      maestroExecuted: false,
      ...base,
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
      maestroExecuted: true,
      maestroExitCode: input.maestroExitCode,
      ...base,
    };
  }

  return {
    ok: true,
    outcome: "SUCCESS",
    status: "SUCCESS",
    failures: [],
    maestroExecuted: true,
    maestroExitCode: 0,
    ...base,
  };
}

module.exports = {
  ANDROID_PACKAGE,
  CANONICAL_PREPROD_API,
  EXPECTED_API_STATUS_LABEL,
  EXPECTED_SCHOOL_CODE,
  BLOCKED,
  EXECUTABLE_FLOWS,
  BLOCKED_FLOWS,
  parseAdbDevices,
  selectDevice,
  validateSchoolCode,
  validateApiUrl,
  validateCredentials,
  validateApkArtifact,
  parseApkPackageName,
  hasPlatformCredentials,
  packageIsInstalled,
  scanApkTextForForbiddenHosts,
  redactSecrets,
  isPathInside,
  publishRedactedExternalText,
  maestroEnvFrom,
  blockedFlowReport,
  mutationCoverageReport,
  executableFlowsFor,
  evaluateRuntimeGate,
};
