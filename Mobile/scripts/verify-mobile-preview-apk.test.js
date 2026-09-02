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
} = require("./verify-mobile-preview-apk");

const SRC = fs.readFileSync(path.join(__dirname, "verify-mobile-preview-apk.js"), "utf8");

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
