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
const WORKSPACE = path.join(MOBILE, "..");
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
const MUTATION_PRECONDITION = "11-attendance-precondition.yaml";
const MUTATION = "12-attendance-persistence.yaml";
const MUTATION_CLEANUP = "13-attendance-restore.yaml";

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

  const preconditionFile = path.join(MAESTRO, MUTATION_PRECONDITION);
  const mutationFile = path.join(MAESTRO, MUTATION);
  const cleanupFile = path.join(MAESTRO, MUTATION_CLEANUP);
  for (const file of [preconditionFile, mutationFile, cleanupFile]) {
    assert.ok(fs.existsSync(file), `flow mutationnel manquant: ${path.basename(file)}`);
  }
  const preconditionSource = fs.readFileSync(preconditionFile, "utf8");
  const mutationSource = fs.readFileSync(mutationFile, "utf8");
  const cleanupSource = fs.readFileSync(cleanupFile, "utf8");
  assert.match(preconditionSource, /SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_STATUS/);
  assert.doesNotMatch(preconditionSource, /Enregistrer l'appel|TARGET_ATTENDANCE_SLUG/);
  assert.match(mutationSource, /SOMAFRIK_E2E_TARGET_ATTENDANCE_SLUG/);
  assert.match(mutationSource, /SOMAFRIK_E2E_TARGET_ATTENDANCE_STATUS/);
  assert.match(mutationSource, /SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_STATUS/);
  assert.match(mutationSource, /stopApp/);
  assert.match(mutationSource, /Appel enregistré/);
  assert.match(cleanupSource, /SOMAFRIK_E2E_ORIGINAL_ATTENDANCE_SLUG/);
  assert.match(cleanupSource, /Enregistrer l'appel/);
  assert.doesNotMatch(cleanupSource, /SOMAFRIK_E2E_TARGET_ATTENDANCE_SLUG/);

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
  assert.match(runtimeSource, /MUTATION_PRECONDITION_FLOW/);
  assert.match(runtimeSource, /MUTATION_FLOWS/);
  assert.match(runtimeSource, /MUTATION_CLEANUP_FLOW/);
  assert.match(runtimeSource, /Précondition mutationnelle non satisfaite/);
  assert.match(runtimeSource, /finally\s*\{/);
  assert.match(runtimeSource, /SOMAFRIK_E2E_ALLOW_MUTATIONS/);
  assert.match(runtimeSource, /CD-IN-26-001/);
  assert.match(runtimeSource, /Mutations E2E interdites/);
  assert.match(runtimeSource, /restauration du fixture/);

  const workflow = path.join(WORKSPACE, ".github", "workflows", "mobile-e2e-runtime.yml");
  assert.ok(fs.existsSync(workflow), "workflow Mobile Runtime E2E manquant");
  const workflowSource = fs.readFileSync(workflow, "utf8");
  assert.match(workflowSource, /workflow_dispatch:/);
  assert.match(workflowSource, /MAESTRO_VERSION:\s*["']2\.8\.0["']/);
  assert.match(workflowSource, /sdkmanager/);
  assert.match(workflowSource, /avdmanager/);
  assert.match(workflowSource, /emulator\/emulator/);
  assert.match(workflowSource, /adb install -r/);
  assert.match(workflowSource, /verify:mobile-ui-e2e-runtime/);
  assert.match(workflowSource, /mobile-e2e-fault-proxy\.js/);
  assert.match(workflowSource, /actions\/upload-artifact@v4/);
  assert.match(workflowSource, /secrets\.SOMAFRIK_E2E_ADMIN_IDENTIFIER/);
  assert.match(workflowSource, /secrets\.SOMAFRIK_E2E_ADMIN_PASSWORD/);
  assert.match(workflowSource, /run_mutations:/);
  assert.match(workflowSource, /SOMAFRIK_E2E_ALLOW_MUTATIONS=1/);
  assert.doesNotMatch(workflowSource, /reactivecircus|android-actions\//i);
  assert.doesNotMatch(workflowSource, /SOMAFRIK_E2E_ADMIN_PASSWORD:\s*["']?[A-Za-z0-9].+/);

  const beforeJobs = workflowSource.split(/^jobs:/m)[0] || "";
  assert.doesNotMatch(beforeJobs, /secrets\./, "Secrets interdits dans env global du workflow");
  const uses = [...workflowSource.matchAll(/^\s*-\s*uses:\s*([^\s]+)\s*$/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0, "actions GitHub attendues");
  for (const action of uses) {
    assert.match(action, /^actions\//, `action tierce interdite dans le workflow runtime: ${action}`);
  }

  const unit = spawnSync(
    process.execPath,
    ["--test", runtimeTest, proxyTest],
    { cwd: MOBILE, encoding: "utf8" },
  );
  if (unit.status !== 0) {
    throw new Error(unit.stderr || unit.stdout || "Tests contrat runtime E2E échoués");
  }

  console.log(
    `OK: contrat Maestro ${REQUIRED.length} flows read-only/fault + précondition/mutation/cleanup ` +
      "+ workflow Android runtime, secrets isolés et actions officielles uniquement. " +
      "Aucune exécution APK n'est revendiquée par ce gate statique.",
  );
}

main();
