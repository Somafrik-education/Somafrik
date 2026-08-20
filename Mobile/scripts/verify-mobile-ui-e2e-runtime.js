/**
 * LOT 8 — preuve runtime black-box Android (Maestro + APK + préprod).
 *
 * Fail-closed : absence de Maestro / adb / device / package / credentials
 * = FAIL/BLOCKED. Jamais SUCCESS par skip.
 *
 * Usage : npm run verify:mobile-ui-e2e-runtime
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const {
  ANDROID_PACKAGE,
  BLOCKED,
  evaluateRuntimeGate,
  executableFlowsFor,
  maestroEnvFrom,
  redactSecrets,
} = require("./lib/e2eRuntimeGate");

const MOBILE = path.join(__dirname, "..");
const ROOT = path.join(MOBILE, "..");
const MAESTRO_DIR = path.join(MOBILE, "maestro");
const ARTIFACTS = path.join(MOBILE, "artifacts", "maestro");

function which(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return {
    available: result.status === 0 && !result.error,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

function runCaptured(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

function ensureArtifacts() {
  fs.mkdirSync(path.join(ARTIFACTS, "screenshots"), { recursive: true });
}

function writeArtifact(name, content) {
  ensureArtifacts();
  const file = path.join(ARTIFACTS, name);
  fs.writeFileSync(file, content);
  return file;
}

function secretsFrom(env) {
  return [
    env.SOMAFRIK_E2E_PASSWORD,
    env.SOMAFRIK_E2E_PLATFORM_PASSWORD,
    env.SOMAFRIK_E2E_IDENTIFIER,
    env.SOMAFRIK_E2E_PLATFORM_IDENTIFIER,
  ].filter(Boolean);
}

function readApkText(apkPath) {
  if (!apkPath || !fs.existsSync(apkPath)) return null;
  try {
    const buf = fs.readFileSync(apkPath);
    const chars = [];
    for (let i = 0; i < buf.length; i += 1) {
      const code = buf[i];
      if (code >= 32 && code <= 126) chars.push(String.fromCharCode(code));
      else chars.push("\n");
    }
    return chars.join("").replace(/\n{2,}/g, "\n");
  } catch {
    return null;
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function dumpApkBadging(apkPath) {
  for (const command of ["aapt", "aapt2"]) {
    const args = command === "aapt2" ? ["dump", "badging", apkPath] : ["dump", "badging", apkPath];
    const result = runCaptured(command, args);
    if (result.status === 0 && result.stdout) return String(result.stdout);
  }
  return "";
}

function writeSummary(summary) {
  writeArtifact("runtime-summary.json", `${JSON.stringify(summary, null, 2)}\n`);
}

function fail(message, summary) {
  if (summary) writeSummary(summary);
  console.error(message);
  process.exit(1);
}

function main() {
  ensureArtifacts();
  const env = process.env;
  const maestro = which("maestro");
  const adb = which("adb");
  const adbDevices = adb.available ? runCaptured("adb", ["devices"]) : { stdout: "", status: 1 };
  const selectedSerial = String(env.ANDROID_SERIAL || "").trim();
  const deviceArgs = selectedSerial ? ["-s", selectedSerial] : [];

  const apkPath = String(env.SOMAFRIK_E2E_APK_PATH || "").trim();
  const apkExists = Boolean(apkPath && fs.existsSync(apkPath));
  const sha256 = apkExists ? sha256File(apkPath) : "";
  const apkText = apkExists ? readApkText(apkPath) : null;
  const badgingOutput = apkExists ? dumpApkBadging(apkPath) : "";

  // adb install -r de CETTE APK (preuve package, pas une app déjà présente).
  const install = apkExists && adb.available
    ? runCaptured("adb", [...deviceArgs, "install", "-r", apkPath])
    : { status: 1, stdout: "", stderr: apkExists ? "adb missing" : "apk missing" };

  const pm = adb.available
    ? runCaptured("adb", [...deviceArgs, "shell", "pm", "path", ANDROID_PACKAGE])
    : { stdout: "", status: 1 };
  const launch = adb.available && pm.status === 0
    ? runCaptured("adb", [
      ...deviceArgs,
      "shell",
      "monkey",
      "-p",
      ANDROID_PACKAGE,
      "-c",
      "android.intent.category.LAUNCHER",
      "1",
    ])
    : { status: 1, stdout: "", stderr: "package missing" };

  const preflight = evaluateRuntimeGate({
    maestroAvailable: maestro.available,
    adbAvailable: adb.available,
    adbDevicesOutput: adbDevices.stdout,
    selectedSerial,
    packagePmOutput: `${pm.stdout || ""}\n${pm.stderr || ""}`,
    appLaunchOk: launch.status === 0,
    apiUrl: env.SOMAFRIK_E2E_API_URL || "",
    env,
    apkPath,
    apkExists,
    sha256,
    badgingOutput,
    apkText,
    apkInstallOk: install.status === 0,
    maestroExecuted: false,
    maestroExitCode: null,
    requireMaestroExecution: false,
  });

  const deviceInfo = redactSecrets(
    [
      `adb devices:\n${adbDevices.stdout || adbDevices.stderr || ""}`,
      `apk: ${apkPath || "(missing)"}`,
      `apkSha256: ${sha256 || "(missing)"}`,
      `aapt:\n${badgingOutput || "(unavailable)"}`,
      `install:\n${install.stdout || install.stderr || ""}`,
      `package:\n${pm.stdout || pm.stderr || ""}`,
      `launch:\n${launch.stdout || launch.stderr || ""}`,
    ].join("\n"),
    secretsFrom(env),
  );
  writeArtifact("device-info.txt", deviceInfo);
  writeArtifact(
    "app-package.txt",
    [
      ANDROID_PACKAGE,
      `apkPath=${apkPath || ""}`,
      `apkSha256=${sha256 || ""}`,
      `installed=${preflight.failures.every((item) => item.code !== BLOCKED.PACKAGE_MISSING)}`,
      `apiProof=maestro-ui-role-status-message`,
      "",
    ].join("\n"),
  );

  if (!preflight.ok) {
    const summary = {
      lot: 8,
      outcome: "FAIL",
      status: preflight.status,
      api: preflight.apiUrl,
      apiProvenance: preflight.apiProvenance,
      apiProof: "maestro-ui-role-status-message",
      package: ANDROID_PACKAGE,
      apkPath: preflight.apkPath,
      apkSha256: preflight.apkSha256,
      maestroExecuted: false,
      failures: preflight.failures,
      blocked: preflight.blocked,
      mutationCoverage: preflight.mutationCoverage,
      executable: preflight.executable,
      note: "Absence de runtime Android/Maestro/APK/credentials = FAIL. Jamais SUCCESS. L'API n'est pas supposée préprod par défaut.",
    };
    fail(
      `verify:mobile-ui-e2e-runtime FAIL/BLOCKED: ${preflight.failures.map((item) => item.code).join(", ")}`,
      summary,
    );
  }

  const flows = executableFlowsFor(env).map((name) => path.join(MAESTRO_DIR, name));
  const missing = flows.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    fail(`parcours runtime manquant: ${missing.join(", ")}`, {
      lot: 8,
      outcome: "FAIL",
      maestroExecuted: false,
      failures: [{ code: BLOCKED.MAESTRO_NOT_EXECUTED, message: "YAML runtime manquant." }],
    });
  }

  const maestroEnv = maestroEnvFrom(env);
  const envArgs = Object.entries(maestroEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const reportPath = path.join(ARTIFACTS, "report.xml");
  const args = [
    "test",
    "--format",
    "junit",
    "--output",
    reportPath,
    ...envArgs,
    ...flows,
  ];
  const maestroRun = runCaptured("maestro", args, { cwd: MOBILE, env: { ...process.env } });
  const log = redactSecrets(
    `${maestroRun.stdout || ""}\n${maestroRun.stderr || ""}`,
    secretsFrom(env),
  );
  writeArtifact("maestro.log", log);

  const result = evaluateRuntimeGate({
    maestroAvailable: true,
    adbAvailable: true,
    adbDevicesOutput: adbDevices.stdout,
    selectedSerial,
    packagePmOutput: `${pm.stdout || ""}\n${pm.stderr || ""}`,
    appLaunchOk: true,
    apiUrl: env.SOMAFRIK_E2E_API_URL || "",
    env,
    apkPath,
    apkExists,
    sha256,
    badgingOutput,
    apkText,
    apkInstallOk: true,
    maestroExecuted: true,
    maestroExitCode: maestroRun.status,
  });

  const summary = {
    lot: 8,
    outcome: result.outcome,
    status: result.status,
    api: result.apiUrl,
    apiProvenance: result.apiProvenance,
    apiProof: "maestro-ui-role-status-message",
    package: ANDROID_PACKAGE,
    device: result.device,
    apkPath: result.apkPath,
    apkSha256: result.apkSha256,
    maestroExecuted: true,
    maestroExitCode: maestroRun.status,
    flowsAttempted: executableFlowsFor(env),
    flowsAttemptedCount: flows.length,
    blocked: result.blocked,
    mutationCoverage: result.mutationCoverage,
    failures: result.failures,
    artifacts: ARTIFACTS,
  };
  writeSummary(summary);

  if (!result.ok) {
    fail(
      `verify:mobile-ui-e2e-runtime FAIL: ${(result.failures[0] && result.failures[0].code) || "MAESTRO"}`,
      summary,
    );
  }

  console.log("verify:mobile-ui-e2e-runtime SUCCESS — Maestro a réellement exécuté les parcours lecture.");
  console.log(`artifacts: ${ARTIFACTS}`);
  console.log("RUNTIME GO uniquement si APK+device+login préprod+parcours. CODE READY ≠ RUNTIME GO.");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), {
      lot: 8,
      outcome: "FAIL",
      maestroExecuted: false,
      failures: [{ code: "BLOCKED_RUNTIME_EXCEPTION", message: "runner exception" }],
    });
  }
}

module.exports = { main, ARTIFACTS, ROOT };
