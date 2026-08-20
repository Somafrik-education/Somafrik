"use strict";

/**
 * Contrat statique LOT 8.
 * Ce gate CI vérifie que les flows runtime sont complets et fail-closed, mais ne
 * prétend jamais avoir piloté une APK. L'exécution réelle est
 * verify:mobile-ui-e2e-runtime sur appareil/émulateur Android.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MOBILE = path.join(__dirname, "..");
const MAESTRO = path.join(MOBILE, "maestro");
const REQUIRED = [
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

function main() {
  const helper = path.join(MAESTRO, "_login-admin-school.yaml");
  assert.ok(fs.existsSync(helper), "helper login Maestro manquant");
  const helperSource = fs.readFileSync(helper, "utf8");
  assert.match(helperSource, /role-school-code-input/);
  assert.match(helperSource, /SOMAFRIK_E2E_SCHOOL_CODE/);
  assert.match(helperSource, /SOMAFRIK_E2E_ADMIN_IDENTIFIER/);
  assert.match(helperSource, /SOMAFRIK_E2E_ADMIN_PASSWORD/);
  assert.match(helperSource, /home-admin-dashboard/);
  assert.match(helperSource, /SOMAFRIK_E2E_ENV_BADGE/);

  for (const name of REQUIRED) {
    const file = path.join(MAESTRO, name);
    assert.ok(fs.existsSync(file), `parcours manquant: ${name}`);
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /appId:\s*com\.somafrik\.app/);
    assert.match(source, /runFlow:\s*_login-admin-school\.yaml/);
    assert.doesNotMatch(
      source,
      /^\s*-\s*assertNotVisible:\s*["']0["']\s*$/m,
      `${name}: assertNotVisible global sur 0 interdit`,
    );
  }

  const runtimeScript = path.join(__dirname, "verify-mobile-ui-e2e-runtime.js");
  const runtimeTest = path.join(__dirname, "verify-mobile-ui-e2e-runtime.test.js");
  const proxyScript = path.join(__dirname, "mobile-e2e-fault-proxy.js");
  const proxyTest = path.join(__dirname, "mobile-e2e-fault-proxy.test.js");
  for (const file of [runtimeScript, runtimeTest, proxyScript, proxyTest]) {
    assert.ok(fs.existsSync(file), `runtime LOT 8 manquant: ${path.basename(file)}`);
  }

  const runtimeSource = fs.readFileSync(runtimeScript, "utf8");
  assert.match(runtimeSource, /assertAppInstalled/);
  assert.match(runtimeSource, /resolveDeviceSerial/);
  assert.match(runtimeSource, /probeApi/);
  assert.match(runtimeSource, /captureScreenshot/);
  assert.match(runtimeSource, /\[REDACTED\]/);
  assert.match(runtimeSource, /LIVE_FLOWS/);
  assert.match(runtimeSource, /FAULT_FLOWS/);

  const unit = spawnSync(
    process.execPath,
    ["--test", runtimeTest, proxyTest],
    { cwd: MOBILE, encoding: "utf8" },
  );
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "Tests contrat runtime E2E échoués");
  }

  console.log(
    `OK: contrat Maestro ${REQUIRED.length} flows + helper + runtime/proxy tests. ` +
      "Aucune exécution APK n'est revendiquée par ce gate statique.",
  );
}

main();
