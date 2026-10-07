/**
 * Contrats probeEasAuth / interpretEasProjectInfo — pas de faux positif BLOCKED_EAS_AUTH.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  EXPO_PROJECT_ID,
  isEasAuthMissing,
  interpretEasProjectInfo,
  resolveSpawn,
} = require("./verify-mobile-preview-apk");

const { CANONICAL_API_URLS } = require("../config/releaseEnvironments");
const SRC = fs.readFileSync(path.join(__dirname, "verify-mobile-preview-apk.js"), "utf8");
const EAS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "eas.json"), "utf8").replace(/^\uFEFF/, ""),
);

assert.equal(CANONICAL_API_URLS.preview, "https://api-preprod.somafrik.app");
assert.equal(EAS.build.preview.env.EXPO_PUBLIC_API_URL, CANONICAL_API_URLS.preview);
assert.equal(EAS.build.preview.env.EXPO_PUBLIC_API_URL_PREVIEW, CANONICAL_API_URLS.preview);
assert.doesNotMatch(
  SRC,
  /bundle\.includes\(PREVIEW_API\)\s*\|\|\s*bundle\.includes\("somafrik-api-preprod\.onrender\.com"\)/,
);
assert.match(SRC, /CANONICAL_API_URLS\.preview/);

assert.deepStrictEqual(
  resolveSpawn("npx", ["expo", "config"], "win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }),
  {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/c", "npx.cmd", "expo", "config"],
  },
);
assert.deepStrictEqual(
  resolveSpawn("npm", ["run", "test"], "win32", { ComSpec: "cmd.exe" }),
  {
    command: "cmd.exe",
    args: ["/d", "/c", "npm.cmd", "run", "test"],
  },
);
assert.deepStrictEqual(
  resolveSpawn("npx", ["expo", "config"], "linux", {}),
  {
    command: "npx",
    args: ["expo", "config"],
  },
);
assert.deepStrictEqual(
  resolveSpawn("node", ["-v"], "win32", { ComSpec: "cmd.exe" }),
  {
    command: "node",
    args: ["-v"],
  },
);
assert.doesNotMatch(SRC, /shell:\s*true/);
assert.doesNotMatch(SRC, /spawnSync\(\s*["']npx(?:\.cmd)?["']/);
assert.match(SRC, /resolveSpawn/);
const nativeSrc = fs.readFileSync(path.join(__dirname, "verify-native-prebuild.js"), "utf8");
assert.match(nativeSrc, /resolveSpawn/);
assert.doesNotMatch(nativeSrc, /shell:\s*true/);
const winWf = fs.readFileSync(
  path.join(__dirname, "..", "..", ".github", "workflows", "mobile-preview-windows.yml"),
  "utf8",
);
assert.match(winWf, /windows-latest/);
assert.match(winWf, /verify-mobile-preview-apk\.test\.js/);
assert.match(winWf, /npx expo config --type public --json/);
assert.match(winWf, /verify:mobile-preview-apk/);

assert.equal(EXPO_PROJECT_ID, "47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5");
assert.doesNotMatch(
  SRC,
  /Not logged in[\s\S]{0,120}\|\|\s*result\.status\s*!==\s*0/,
  "régression : status !== 0 ne doit plus être assimilé à une absence d'auth",
);

assert.equal(isEasAuthMissing("Not logged in"), true);
assert.equal(
  isEasAuthMissing(
    "An Expo user account is required to proceed.\nEither log in with eas login or set the EXPO_TOKEN environment variable",
  ),
  true,
);
assert.equal(isEasAuthMissing("Project not found"), false);
assert.equal(isEasAuthMissing("Permission denied: you do not have access to this project"), false);
assert.equal(isEasAuthMissing("Error: build command failed."), false);
assert.equal(isEasAuthMissing("ENOTFOUND expo.dev"), false);

assert.equal(
  interpretEasProjectInfo({ status: 1, stdout: "", stderr: "Not logged in\n" }),
  "BLOCKED_EAS_AUTH",
);
assert.equal(
  interpretEasProjectInfo({
    status: 1,
    stdout: "",
    stderr:
      "An Expo user account is required to proceed.\n"
      + "Either log in with eas login or set the EXPO_TOKEN environment variable if you're using EAS CLI on CI",
  }),
  "BLOCKED_EAS_AUTH",
);

assert.throws(
  () => interpretEasProjectInfo({ status: 1, stderr: "Not logged in\n" }, { requireAuth: true }),
  /EAS_AUTH_REQUIRED/,
);

const previousRequire = process.env.SOMAFRIK_REQUIRE_EAS_AUTH;
process.env.SOMAFRIK_REQUIRE_EAS_AUTH = "1";
try {
  assert.throws(
    () => interpretEasProjectInfo({ status: 1, stderr: "Not logged in\n" }),
    /EAS_AUTH_REQUIRED/,
  );
} finally {
  if (previousRequire == null) delete process.env.SOMAFRIK_REQUIRE_EAS_AUTH;
  else process.env.SOMAFRIK_REQUIRE_EAS_AUTH = previousRequire;
}

assert.throws(
  () => interpretEasProjectInfo({ status: 1, stdout: "", stderr: "Project not found\n" }),
  /Project not found/,
);
assert.throws(
  () => interpretEasProjectInfo({
    status: 1,
    stdout: "",
    stderr: "Permission denied: you do not have access to this project\n",
  }),
  /Permission denied/,
);
assert.throws(
  () => interpretEasProjectInfo({ status: 1, stdout: "", stderr: "Error: EAS service unavailable\n" }),
  /EAS service unavailable|status 1/,
);
assert.throws(
  () => interpretEasProjectInfo({
    status: null,
    error: Object.assign(new Error("spawn ETIMEDOUT"), { code: "ETIMEDOUT" }),
    stdout: "",
    stderr: "",
  }),
  /ETIMEDOUT/,
);

assert.equal(
  interpretEasProjectInfo({
    status: 0,
    stdout: `fullName: @owner/somafrik\nID: ${EXPO_PROJECT_ID}\n`,
    stderr: "",
  }),
  "OK",
);
assert.throws(
  () => interpretEasProjectInfo({
    status: 0,
    stdout: "fullName: @owner/other\nID: 00000000-0000-0000-0000-000000000000\n",
    stderr: "",
  }),
  /projectId attendu/,
);

console.log("OK: interpretEasProjectInfo — auth manquante = BLOCKED ; le reste FAIL ; projectId OK");
