/**
 * Smoke natif SQLCipher : APK (pas Expo Go) + adb.
 *
 *   PRAGMA cipher_version → valeur non vide
 *   write → kill app → reopen → read OK
 *
 * Exit 0 + BLOCKED_NATIVE_SQLCIPHER_SMOKE si aucun device.
 * Exit 1 si un device est présent et que la preuve échoue.
 */
"use strict";

const { spawnSync } = require("child_process");
const { ANDROID_PACKAGE } = require("../config/releaseEnvironments");

const TAG = "L1_SQLCIPHER_SMOKE";
const LAUNCH_WAIT_MS = 25000;
const RELAUNCH_WAIT_MS = 25000;

function adb(args, options = {}) {
  return spawnSync("adb", args, {
    encoding: "utf8",
    timeout: options.timeout || 20000,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function deviceSerials() {
  const result = adb(["devices"]);
  return String(result.stdout || "")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /\tdevice$/.test(line))
    .map((line) => line.split("\t")[0]);
}

function sleep(ms) {
  spawnSync("sleep", [String(ms / 1000)]);
}

function logcatDump() {
  const result = adb(["logcat", "-d", "-t", "4000"], { timeout: 15000 });
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function launchApp() {
  adb(["shell", "am", "force-stop", ANDROID_PACKAGE]);
  sleep(500);
  adb(["logcat", "-c"]);
  const monkey = adb([
    "shell",
    "monkey",
    "-p",
    ANDROID_PACKAGE,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ]);
  if (monkey.status !== 0) {
    adb([
      "shell",
      "am",
      "start",
      "-n",
      `${ANDROID_PACKAGE}/.MainActivity`,
    ]);
  }
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  let dump = "";
  while (Date.now() - started < timeoutMs) {
    dump = logcatDump();
    if (predicate(dump)) return dump;
    sleep(1000);
  }
  throw new Error(`${label}\n--- logcat ---\n${dump.slice(-4000)}`);
}

function cipherVersionOf(dump) {
  const match = dump.match(new RegExp(`${TAG} cipher_version=([^\\s]+(?:\\s+community)?)`));
  return match ? match[1].trim() : "";
}

function main() {
  const apk = process.env.ANDROID_APK || "";
  const serials = deviceSerials();
  if (!serials.length) {
    console.log(
      "BLOCKED_NATIVE_SQLCIPHER_SMOKE: aucun device/emulator Android pour PRAGMA cipher_version",
    );
    return;
  }
  console.log(`device: ${serials.join(",")}`);

  if (apk) {
    const installed = adb(["install", "-r", apk], { timeout: 120000 });
    if (installed.status !== 0) {
      throw new Error(`adb install failed:\n${installed.stdout || ""}\n${installed.stderr || ""}`);
    }
    console.log(`installed: ${apk}`);
  }

  launchApp();
  const first = waitFor(
    (dump) => dump.includes(`${TAG} cipher_version=`) && /persist=(init|ok)/.test(dump),
    LAUNCH_WAIT_MS,
    "premier lancement: cipher_version + persist manquants",
  );
  const firstVersion = cipherVersionOf(first);
  if (!firstVersion) {
    throw new Error("PRAGMA cipher_version vide au premier lancement");
  }
  console.log(`first: cipher_version=${firstVersion}`);

  adb(["shell", "am", "force-stop", ANDROID_PACKAGE]);
  sleep(1500);
  adb(["logcat", "-c"]);
  launchApp();
  const second = waitFor(
    (dump) => dump.includes(`${TAG} cipher_version=`) && dump.includes(`${TAG} persist=ok`),
    RELAUNCH_WAIT_MS,
    "relaunch: persist=ok manquant (write/kill/read SQLCipher échoué)",
  );
  const secondVersion = cipherVersionOf(second);
  if (!secondVersion) {
    throw new Error("PRAGMA cipher_version vide au relaunch");
  }
  console.log(`relaunch: cipher_version=${secondVersion} persist=ok`);
  console.log("OK: native SQLCipher smoke (cipher_version + write/kill/relaunch/read)");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
