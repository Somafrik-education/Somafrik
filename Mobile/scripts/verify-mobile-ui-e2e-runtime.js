"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  ANDROID_PACKAGE,
  CANONICAL_API_URLS,
} = require("../config/releaseEnvironments");
const {
  isInternalSchoolAlias,
  isV2SchoolLoginCode,
} = require("../../backend/lib/schoolCodeV2");

const MOBILE_ROOT = path.join(__dirname, "..");
const MAESTRO_ROOT = path.join(MOBILE_ROOT, "maestro");

const ALL_FLOWS = [
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
];
const LIVE_FLOWS = ALL_FLOWS.filter((name) => name !== "09-partial-domain-error.yaml");
const FAULT_FLOWS = ["09-partial-domain-error.yaml"];
const MUTATION_FLOWS = ["11-attendance-persistence.yaml"];
const MUTATION_CLEANUP_FLOW = "12-attendance-restore.yaml";
const ATTENDANCE_STATUSES = ["Présent", "Absent", "Retard", "Justifié"];
const SECRET_ENV_KEYS = [
  "SOMAFRIK_E2E_ADMIN_IDENTIFIER",
  "SOMAFRIK_E2E_ADMIN_PASSWORD",
];

function required(value, name) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} est obligatoire pour le runtime E2E.`);
  return text;
}

function normalizeMode(value) {
  const mode = String(value || "live").trim().toLowerCase();
  if (!new Set(["live", "fault", "mutation"]).has(mode)) {
    throw new Error(`SOMAFRIK_E2E_MODE doit valoir live, fault ou mutation (reçu: ${mode}).`);
  }
  return mode;
}

function slugifyAttendanceStatus(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function requireAttendanceStatus(value, name) {
  const status = required(value, name);
  if (!ATTENDANCE_STATUSES.includes(status)) {
    throw new Error(`${name} invalide: ${status}. Valeurs: ${ATTENDANCE_STATUSES.join(", ")}.`);
  }
  return status;
}

function validateRuntimeConfig(env = process.env) {
  const mode = normalizeMode(env.SOMAFRIK_E2E_MODE);
  const apiUrl = String(
    env.SOMAFRIK_E2E_API_URL ||
      (mode === "fault" ? "http://10.0.2.2:5055" : CANONICAL_API_URLS.preview),
  )
    .trim()
    .replace(/\/$/, "");
  const probeUrl = String(
    env.SOMAFRIK_E2E_PROBE_URL ||
      (mode === "fault" ? "http://127.0.0.1:5055" : apiUrl),
  )
    .trim()
    .replace(/\/$/, "");

  if ((mode === "live" || mode === "mutation") && apiUrl !== CANONICAL_API_URLS.preview) {
    throw new Error(
      `Le runtime E2E Preview doit cibler uniquement ${CANONICAL_API_URLS.preview} (reçu: ${apiUrl}).`,
    );
  }
  if (mode === "fault" && !/^http:\/\/10\.0\.2\.2:\d+$/i.test(apiUrl)) {
    throw new Error(
      `Le mode fault doit cibler le proxy hôte via 10.0.2.2 (reçu: ${apiUrl}).`,
    );
  }

  const schoolCode = required(env.SOMAFRIK_E2E_SCHOOL_CODE, "SOMAFRIK_E2E_SCHOOL_CODE").toUpperCase();
  if (!isV2SchoolLoginCode(schoolCode) || isInternalSchoolAlias(schoolCode)) {
    throw new Error(`SOMAFRIK_E2E_SCHOOL_CODE doit être un login_code V2 public (reçu: ${schoolCode}).`);
  }

  const config = {
    mode,
    apiUrl,
    probeUrl,
    envBadge: required(
      env.SOMAFRIK_E2E_ENV_BADGE || (mode === "fault" ? "Développement" : "Preview QA"),
      "SOMAFRIK_E2E_ENV_BADGE",
    ),
    schoolCode,
    schoolName: required(env.SOMAFRIK_E2E_SCHOOL_NAME, "SOMAFRIK_E2E_SCHOOL_NAME"),
    adminIdentifier: required(
      env.SOMAFRIK_E2E_ADMIN_IDENTIFIER,
      "SOMAFRIK_E2E_ADMIN_IDENTIFIER",
    ),
    adminPassword: required(
      env.SOMAFRIK_E2E_ADMIN_PASSWORD,
      "SOMAFRIK_E2E_ADMIN_PASSWORD",
    ),
    deviceSerial: String(env.SOMAFRIK_E2E_DEVICE_SERIAL ?? "").trim(),
  };

  if (mode === "live") {
    Object.assign(config, {
      expectedUsers: required(env.SOMAFRIK_E2E_EXPECTED_USERS, "SOMAFRIK_E2E_EXPECTED_USERS"),
      expectedPresence: required(
        env.SOMAFRIK_E2E_EXPECTED_PRESENCE,
        "SOMAFRIK_E2E_EXPECTED_PRESENCE",
      ),
      expectedPayments: required(
        env.SOMAFRIK_E2E_EXPECTED_PAYMENTS,
        "SOMAFRIK_E2E_EXPECTED_PAYMENTS",
      ),
      className: required(env.SOMAFRIK_E2E_CLASS_NAME, "SOMAFRIK_E2E_CLASS_NAME"),
      studentName: required(env.SOMAFRIK_E2E_STUDENT_NAME, "SOMAFRIK_E2E_STUDENT_NAME"),
      teacherName: required(env.SOMAFRIK_E2E_TEACHER_NAME, "SOMAFRIK_E2E_TEACHER_NAME"),
      paymentReference: required(
        env.SOMAFRIK_E2E_PAYMENT_REFERENCE,
        "SOMAFRIK_E2E_PAYMENT_REFERENCE",
      ),
      evaluationLabel: required(
        env.SOMAFRIK_E2E_EVALUATION_LABEL,
        "SOMAFRIK_E2E_EVALUATION_LABEL",
      ),
    });
  }

  if (mode === "fault") {
    Object.assign(config, {
      expectedPresence: required(
        env.SOMAFRIK_E2E_EXPECTED_PRESENCE,
        "SOMAFRIK_E2E_EXPECTED_PRESENCE",
      ),
      expectedPayments: required(
        env.SOMAFRIK_E2E_EXPECTED_PAYMENTS,
        "SOMAFRIK_E2E_EXPECTED_PAYMENTS",
      ),
    });
  }

  if (mode === "mutation") {
    if (env.SOMAFRIK_E2E_ALLOW_MUTATIONS !== "1") {
      throw new Error(
        "Le mode mutation exige SOMAFRIK_E2E_ALLOW_MUTATIONS=1 explicitement.",
      );
    }
    const protectedCodes = new Set(
      String(env.SOMAFRIK_E2E_PROTECTED_SCHOOL_CODES || "CD-IN-26-001")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    );
    if (protectedCodes.has(schoolCode)) {
      throw new Error(
        `Mutations E2E interdites sur l'établissement protégé ${schoolCode}. Utiliser un tenant QA dédié.`,
      );
    }

    const originalAttendanceStatus = requireAttendanceStatus(
      env.SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_STATUS,
      "SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_STATUS",
    );
    const targetAttendanceStatus = requireAttendanceStatus(
      env.SOMAFRIK_E2E_TARGET_ATTENDANCE_STATUS,
      "SOMAFRIK_E2E_TARGET_ATTENDANCE_STATUS",
    );
    if (originalAttendanceStatus === targetAttendanceStatus) {
      throw new Error("Le statut cible doit être différent du statut initial pour prouver la persistance.");
    }

    Object.assign(config, {
      className: required(env.SOMAFRIK_E2E_CLASS_NAME, "SOMAFRIK_E2E_CLASS_NAME"),
      studentName: required(env.SOMAFRIK_E2E_STUDENT_NAME, "SOMAFRIK_E2E_STUDENT_NAME"),
      studentId: required(env.SOMAFRIK_E2E_STUDENT_ID, "SOMAFRIK_E2E_STUDENT_ID"),
      originalAttendanceStatus,
      originalAttendanceSlug: slugifyAttendanceStatus(originalAttendanceStatus),
      targetAttendanceStatus,
      targetAttendanceSlug: slugifyAttendanceStatus(targetAttendanceStatus),
      mutationsAllowed: true,
    });
  }

  return config;
}

function flowsForMode(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === "fault") return FAULT_FLOWS;
  if (normalized === "mutation") return MUTATION_FLOWS;
  return LIVE_FLOWS;
}

function parseAdbDevices(stdout) {
  return String(stdout ?? "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || MOBILE_ROOT,
    env: options.env || process.env,
    encoding: options.binary ? null : "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${command} indisponible: ${result.error.message}`);
  }
  return result;
}

function assertCommand(command, args = ["--version"]) {
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(`${command} requis pour le runtime E2E (code ${result.status ?? 1}).`);
  }
}

function resolveDeviceSerial(config) {
  const result = run("adb", ["devices"]);
  if (result.status !== 0) throw new Error("adb devices a échoué.");
  const devices = parseAdbDevices(result.stdout);
  if (config.deviceSerial) {
    if (!devices.includes(config.deviceSerial)) {
      throw new Error(`Appareil ADB demandé introuvable: ${config.deviceSerial}.`);
    }
    return config.deviceSerial;
  }
  if (devices.length !== 1) {
    throw new Error(
      `Le runtime E2E exige exactement un appareil Android actif (détecté: ${devices.length}). ` +
        "Définir SOMAFRIK_E2E_DEVICE_SERIAL si plusieurs appareils sont connectés.",
    );
  }
  return devices[0];
}

function assertAppInstalled(serial) {
  const result = run("adb", ["-s", serial, "shell", "pm", "path", ANDROID_PACKAGE]);
  if (result.status !== 0 || !String(result.stdout ?? "").includes("package:")) {
    throw new Error(
      `APK ${ANDROID_PACKAGE} non installée sur ${serial}. Un scaffold sans APK ne peut pas être vert.`,
    );
  }
}

async function probeApi(probeUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`API/proxy E2E HTTP ${response.status}.`);
    }
    const payload = await response.json();
    if (payload?.status !== "ok" || payload?.name !== "Somafrik API") {
      throw new Error("La cible E2E ne répond pas avec le contrat Somafrik API attendu.");
    }
    return {
      status: payload.status,
      name: payload.name,
      database: payload.database,
      mode: payload.mode,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function flowEnvPairs(config) {
  const pairs = {
    SOMAFRIK_E2E_ENV_BADGE: config.envBadge,
    SOMAFRIK_E2E_SCHOOL_CODE: config.schoolCode,
    SOMAFRIK_E2E_SCHOOL_NAME: config.schoolName,
    SOMAFRIK_E2E_ADMIN_IDENTIFIER: config.adminIdentifier,
    SOMAFRIK_E2E_ADMIN_PASSWORD: config.adminPassword,
    SOMAFRIK_E2E_EXPECTED_USERS: config.expectedUsers,
    SOMAFRIK_E2E_EXPECTED_PRESENCE: config.expectedPresence,
    SOMAFRIK_E2E_EXPECTED_PAYMENTS: config.expectedPayments,
    SOMAFRIK_E2E_CLASS_NAME: config.className,
    SOMAFRIK_E2E_STUDENT_NAME: config.studentName,
    SOMAFRIK_E2E_TEACHER_NAME: config.teacherName,
    SOMAFRIK_E2E_PAYMENT_REFERENCE: config.paymentReference,
    SOMAFRIK_E2E_EVALUATION_LABEL: config.evaluationLabel,
    SOMAFRIK_E2E_STUDENT_ID: config.studentId,
    SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_STATUS: config.originalAttendanceStatus,
    SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_SLUG: config.originalAttendanceSlug,
    SOMAFRIK_E2E_TARGET_ATTENDANCE_STATUS: config.targetAttendanceStatus,
    SOMAFRIK_E2E_TARGET_ATTENDANCE_SLUG: config.targetAttendanceSlug,
  };
  return Object.entries(pairs).filter(([, value]) => String(value ?? "").length > 0);
}

function redact(text, config) {
  let output = String(text ?? "");
  for (const secret of [config.adminIdentifier, config.adminPassword]) {
    if (!secret) continue;
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function ensureFlowFiles() {
  for (const name of [
    ...ALL_FLOWS,
    ...MUTATION_FLOWS,
    MUTATION_CLEANUP_FLOW,
    "_login-admin-school.yaml",
  ]) {
    const file = path.join(MAESTRO_ROOT, name);
    if (!fs.existsSync(file)) throw new Error(`Parcours Maestro manquant: ${name}`);
  }
}

function captureScreenshot(serial, destination) {
  const result = run("adb", ["-s", serial, "exec-out", "screencap", "-p"], { binary: true });
  if (result.status === 0 && result.stdout?.length) {
    fs.writeFileSync(destination, result.stdout);
  }
}

function runMaestroFlow(flowName, config, serial, artifactDir) {
  const flowPath = path.join(MAESTRO_ROOT, flowName);
  const args = ["test"];
  for (const [key, value] of flowEnvPairs(config)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(flowPath);

  const result = run("maestro", args, {
    env: {
      ...process.env,
      ANDROID_SERIAL: serial,
    },
  });

  const safeLog = redact(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    config,
  );
  const stem = flowName.replace(/\.ya?ml$/i, "");
  fs.writeFileSync(path.join(artifactDir, `${stem}.log`), safeLog, "utf8");
  captureScreenshot(serial, path.join(artifactDir, `${stem}.png`));

  return {
    flow: flowName,
    success: result.status === 0,
    exitCode: result.status ?? 1,
  };
}

function writeManifest(artifactDir, manifest) {
  fs.writeFileSync(
    path.join(artifactDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  const config = validateRuntimeConfig(process.env);
  ensureFlowFiles();
  assertCommand("adb", ["version"]);
  assertCommand("maestro", ["--version"]);
  const serial = resolveDeviceSerial(config);
  assertAppInstalled(serial);
  const api = await probeApi(config.probeUrl);
  const flows = flowsForMode(config.mode);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactDir = path.resolve(
    process.env.SOMAFRIK_E2E_ARTIFACT_DIR ||
      path.join(MOBILE_ROOT, "artifacts", "maestro-runtime", `${config.mode}-${stamp}`),
  );
  fs.mkdirSync(artifactDir, { recursive: true });

  const manifest = {
    startedAt: new Date().toISOString(),
    runtimeMode: config.mode,
    packageName: ANDROID_PACKAGE,
    apiUrl: config.apiUrl,
    probeUrl: config.probeUrl,
    api,
    schoolCode: config.schoolCode,
    schoolName: config.schoolName,
    deviceSerial: serial,
    reversibleMutation: config.mode === "mutation",
    flows: [],
    cleanupFlows: [],
  };

  console.log(`Runtime E2E (${config.mode}): ${ANDROID_PACKAGE} sur ${serial}`);
  console.log(`API app: ${config.apiUrl}`);
  console.log(`Établissement QA: ${config.schoolCode}`);
  console.log(`Preuves: ${artifactDir}`);

  if (config.mode === "mutation") {
    let mutationFailure = null;
    try {
      for (const flowName of flows) {
        const outcome = runMaestroFlow(flowName, config, serial, artifactDir);
        manifest.flows.push(outcome);
        writeManifest(artifactDir, manifest);
        if (!outcome.success) {
          mutationFailure = new Error(
            `E2E mutation échoué: ${flowName} (code ${outcome.exitCode}).`,
          );
          break;
        }
      }
    } finally {
      const cleanup = runMaestroFlow(MUTATION_CLEANUP_FLOW, config, serial, artifactDir);
      manifest.cleanupFlows.push(cleanup);
      manifest.cleanupSucceeded = cleanup.success;
      writeManifest(artifactDir, manifest);
      if (!cleanup.success) {
        throw new Error(
          `P0 E2E: restauration du fixture de présence échouée (${MUTATION_CLEANUP_FLOW}, code ${cleanup.exitCode}).`,
        );
      }
    }
    if (mutationFailure) throw mutationFailure;
  } else {
    for (const flowName of flows) {
      const outcome = runMaestroFlow(flowName, config, serial, artifactDir);
      manifest.flows.push(outcome);
      writeManifest(artifactDir, manifest);
      if (!outcome.success) {
        throw new Error(`E2E runtime échoué: ${flowName} (code ${outcome.exitCode}).`);
      }
    }
  }

  manifest.completedAt = new Date().toISOString();
  manifest.success = true;
  writeManifest(artifactDir, manifest);
  console.log(`OK runtime ${config.mode}: ${flows.length}/${flows.length} parcours réellement exécutés.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  ALL_FLOWS,
  LIVE_FLOWS,
  FAULT_FLOWS,
  MUTATION_FLOWS,
  MUTATION_CLEANUP_FLOW,
  ATTENDANCE_STATUSES,
  SECRET_ENV_KEYS,
  flowsForMode,
  parseAdbDevices,
  validateRuntimeConfig,
  redact,
  flowEnvPairs,
  slugifyAttendanceStatus,
};
