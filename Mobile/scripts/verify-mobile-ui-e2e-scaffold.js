/**
 * Scaffold Maestro — présence + contrat anti-faux-E2E.
 * Ce n'est PAS une exécution black-box de l'APK.
 *
 * Interdit : skip Maestro déclaré GO, assertNotVisible "0"/"catalog",
 * login sans saisie de credential, PIN hardcodé, CD-2026-0001, SCH-*.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const MOBILE = path.join(__dirname, "..");
const MAESTRO = path.join(MOBILE, "maestro");
const RUNTIME = path.join(MOBILE, "scripts", "verify-mobile-ui-e2e-runtime.js");
const GATE = path.join(MOBILE, "scripts", "lib", "e2eRuntimeGate.js");

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

function walkYaml(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkYaml(full, out);
    else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) out.push(full);
  }
  return out;
}

function main() {
  const loginFlow = fs.readFileSync(path.join(MAESTRO, "flows", "login-admin-school.yaml"), "utf8");
  for (const name of REQUIRED) {
    const file = path.join(MAESTRO, name);
    assert.ok(fs.existsSync(file), `parcours manquant: ${name}`);
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /appId:\s*com\.somafrik\.app/);
  }

  const allYaml = walkYaml(MAESTRO).map((file) => ({
    file,
    source: fs.readFileSync(file, "utf8"),
    rel: path.relative(MAESTRO, file).split(path.sep).join("/"),
  }));

  for (const item of allYaml) {
    assert.doesNotMatch(
      item.source,
      /^\s*- wait\s*:/m,
      `${item.rel}: commande Maestro 'wait:' interdite. Utiliser extendedWaitUntil.`,
    );
    assert.doesNotMatch(
      item.source,
      /home-overview-title/,
      `${item.rel}: home-overview-title n'est pas un identifiant métier Home.`,
    );
    assert.doesNotMatch(
      item.source,
      /assertNotVisible:\s*["']0["']/,
      `${item.rel}: assertNotVisible "0" interdit (0 peut être métier).`,
    );
    assert.doesNotMatch(
      item.source,
      /assertNotVisible:\s*["']catalog["']/,
      `${item.rel}: assertNotVisible "catalog" n'est pas une preuve.`,
    );
    assert.doesNotMatch(item.source, /CD-2026-0001/, `${item.rel}: code legacy interdit.`);
    assert.doesNotMatch(item.source, /SCH-[A-Z0-9]+/, `${item.rel}: alias interne SCH-* interdit.`);
    assert.doesNotMatch(
      item.source,
      /inputText:\s*["']\d{4,}["']/,
      `${item.rel}: PIN/password hardcodé interdit.`,
    );
    assert.doesNotMatch(
      item.source,
      /password:\s*["'][^"']+["']/i,
      `${item.rel}: secret hardcodé interdit.`,
    );
  }

  assert.match(loginFlow, /id:\s*["']role-school-code-input["']/);
  assert.match(loginFlow, /id:\s*["']role-verify-button["']/);
  assert.match(loginFlow, /id:\s*["']role-school-card["']/);
  assert.match(loginFlow, /id:\s*["']role-open-login-button["']/);
  assert.match(loginFlow, /id:\s*["']login-identifier-input["']/);
  assert.match(loginFlow, /id:\s*["']login-password-input["']/);
  assert.match(loginFlow, /id:\s*["']login-submit-button["']/);
  assert.match(loginFlow, /id:\s*["']home-admin-dashboard["']/);
  assert.match(loginFlow, /id:\s*["']role-status-message["']/);
  assert.match(loginFlow, /somafrik-api-preprod\.onrender\.com/);
  assert.match(loginFlow, /\$\{SOMAFRIK_E2E_SCHOOL_CODE\}/);
  assert.match(loginFlow, /\$\{SOMAFRIK_E2E_IDENTIFIER\}/);
  assert.match(loginFlow, /\$\{SOMAFRIK_E2E_PASSWORD\}/);

  const login01 = fs.readFileSync(path.join(MAESTRO, "01-login-admin-school.yaml"), "utf8");
  assert.match(login01, /runFlow:\s*flows\/login-admin-school\.yaml/);
  assert.match(login01, /home-admin-dashboard/);
  assert.match(login01, /home-users-value/);
  assert.doesNotMatch(login01, /home-overview-title/);

  const home = fs.readFileSync(path.join(MAESTRO, "02-home-metrics.yaml"), "utf8");
  assert.match(home, /home-users-value/);
  assert.match(home, /home-presence-value/);
  assert.match(home, /home-payments-value/);
  assert.match(home, /Indisponible/);

  const users = fs.readFileSync(path.join(MAESTRO, "03-users-matches-home.yaml"), "utf8");
  assert.match(users, /users-empty/);
  assert.match(users, /users-list/);
  assert.match(users, /copiedText/);

  const partial = fs.readFileSync(path.join(MAESTRO, "09-partial-domain-error.yaml"), "utf8");
  assert.match(partial, /BLOCKED_NO_FAILURE_INJECTION/);

  const relaunch = fs.readFileSync(path.join(MAESTRO, "10-relaunch-no-catalog.yaml"), "utf8");
  assert.match(relaunch, /stopApp/);
  assert.match(relaunch, /clearState:\s*false/);
  assert.match(relaunch, /home-admin-dashboard/);
  assert.match(relaunch, /home-users-value/);
  assert.doesNotMatch(relaunch, /home-overview-title/);
  assert.doesNotMatch(relaunch, /assertNotVisible:\s*["']catalog["']/);

  const attendance = fs.readFileSync(path.join(MAESTRO, "07-attendance.yaml"), "utf8");
  assert.match(attendance, /MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE/);
  assert.doesNotMatch(attendance, /attendance-action-/);
  assert.doesNotMatch(attendance, /attendance-save/);

  const attendanceMutation = fs.readFileSync(path.join(MAESTRO, "12-attendance-mutation.yaml"), "utf8");
  assert.match(attendanceMutation, /appId:\s*com\.somafrik\.app/);
  assert.match(attendanceMutation, /attendance-class-\$\{SOMAFRIK_E2E_ATTENDANCE_CLASS_SLUG\}/);
  assert.match(attendanceMutation, /attendance-action-\$\{SOMAFRIK_E2E_ATTENDANCE_STUDENT_A\}-present/);
  assert.match(attendanceMutation, /attendance-action-\$\{SOMAFRIK_E2E_ATTENDANCE_STUDENT_B\}-absent/);
  assert.match(attendanceMutation, /attendance-action-\$\{SOMAFRIK_E2E_ATTENDANCE_STUDENT_C\}-late/);
  assert.match(attendanceMutation, /attendance-action-\$\{SOMAFRIK_E2E_ATTENDANCE_STUDENT_D\}-excused/);
  assert.match(attendanceMutation, /attendance-save/);
  assert.match(attendanceMutation, /clearState:\s*false/);
  assert.match(attendanceMutation, /MUTATION_ATTENDANCE_BLOCKED_NO_QA_FIXTURE/);
  assert.match(attendanceMutation, /assert-attendance-qa-statuses/);
  assert.doesNotMatch(attendanceMutation, /assertVisible:\s*["']Statut :/);
  assert.doesNotMatch(attendanceMutation, /inputText:\s*["']\d{4,}["']/);

  const attendanceStatusProof = fs.readFileSync(
    path.join(MAESTRO, "flows", "assert-attendance-qa-statuses.yaml"),
    "utf8",
  );
  assert.match(attendanceStatusProof, /attendance-current-status-\$\{SOMAFRIK_E2E_ATTENDANCE_STUDENT_A\}-present/);
  assert.match(attendanceStatusProof, /attendance-current-status-\$\{SOMAFRIK_E2E_ATTENDANCE_STUDENT_B\}-absent/);
  assert.match(attendanceStatusProof, /attendance-current-status-\$\{SOMAFRIK_E2E_ATTENDANCE_STUDENT_C\}-late/);
  assert.match(attendanceStatusProof, /attendance-current-status-\$\{SOMAFRIK_E2E_ATTENDANCE_STUDENT_D\}-excused/);
  assert.match(attendanceStatusProof, /copyTextFrom/);
  assert.match(attendanceStatusProof, /copiedText\.includes\('Statut : Présent'\)/);
  assert.match(attendanceStatusProof, /copiedText\.includes\('Statut : Absent'\)/);
  assert.match(attendanceStatusProof, /copiedText\.includes\('Statut : Retard'\)/);
  assert.match(attendanceStatusProof, /copiedText\.includes\('Statut : Justifié'\)/);

  const notes = fs.readFileSync(path.join(MAESTRO, "08-notes.yaml"), "utf8");
  assert.match(notes, /evaluations-v2/);
  assert.match(notes, /MUTATION_NOTES_BLOCKED_NO_QA_FIXTURE/);
  assert.doesNotMatch(notes, /evaluations-v2-save/);
  assert.match(notes, /evaluations-v2-list/);

  const teachers = fs.readFileSync(path.join(MAESTRO, "06-teachers.yaml"), "utf8");
  assert.match(teachers, /teachers-list/);

  const payments = fs.readFileSync(path.join(MAESTRO, "05-payments.yaml"), "utf8");
  assert.match(payments, /home-payments-value/);
  assert.doesNotMatch(payments, /tapOn:.*[Cc]r[eé]er/);

  const attendanceNav = fs.readFileSync(path.join(MAESTRO, "07-attendance.yaml"), "utf8");
  assert.match(attendanceNav, /home-presence-value/);

  assert.match(partial, /blocked-no-failure-injection/);

  const tenant = fs.readFileSync(path.join(MAESTRO, "11-platform-tenant-switch.yaml"), "utf8");
  assert.match(tenant, /SUPERADMIN/);
  assert.match(tenant, /selected:\s*true/);
  assert.match(tenant, /Établissement :/);
  assert.match(tenant, /role-status-message/);
  assert.match(tenant, /id:\s*["']school-selector["']/);
  assert.doesNotMatch(
    tenant,
    /home-admin-dashboard/,
    "11-platform-tenant-switch.yaml: home-admin-dashboard est réservé à school_admin ; un login SUPERADMIN doit attendre school-selector.",
  );
  assert.doesNotMatch(tenant, /^\s*- wait\s*:/m);

  for (const item of allYaml) {
    if (!/SUPERADMIN|COUNTRYADMIN/.test(item.source)) continue;
    assert.doesNotMatch(
      item.source,
      /home-admin-dashboard/,
      `${item.rel}: un flux plateforme ne doit pas cibler home-admin-dashboard (school_admin uniquement).`,
    );
    assert.match(
      item.source,
      /school-selector/,
      `${item.rel}: un flux plateforme doit attendre school-selector après login.`,
    );
  }

  const scaffoldSelf = fs.readFileSync(__filename, "utf8");
  assert.doesNotMatch(scaffoldSelf, /spawnSync\(\s*["']maestro["']/);

  const skipFlag = ["SOMAFRIK", "RUN", "MAESTRO"].join("_");
  const runtime = fs.readFileSync(RUNTIME, "utf8");
  assert.match(runtime, /evaluateRuntimeGate/);
  assert.match(runtime, /Jamais SUCCESS/);
  assert.match(runtime, /adb install/);
  assert.match(runtime, /uninstall/);
  assert.match(runtime, /inspectApkIdentity/);
  assert.match(runtime, /badgingOutput:\s*identity\.output/);
  assert.doesNotMatch(runtime, /["']install["'],\s*["']-r["']/);
  assert.match(runtime, /"--output",\s*rawReportPath/);
  assert.match(runtime, /os\.tmpdir\(\)/);
  assert.match(runtime, /publishRedactedExternalText/);
  assert.doesNotMatch(runtime, /"--output",\s*path\.join\(ARTIFACTS/);
  assert.equal(runtime.includes(skipFlag), false, "runtime ne doit pas honorer un skip-vert optionnel");
  assert.doesNotMatch(runtime, /SOMAFRIK_E2E_API_URL \|\| CANONICAL_PREPROD_API/);
  const gate = fs.readFileSync(GATE, "utf8");
  assert.match(gate, /BLOCKED_MAESTRO_NOT_EXECUTED/);
  assert.match(gate, /BLOCKED_NO_FAILURE_INJECTION/);
  assert.match(gate, /BLOCKED_APK_PACKAGE_INSPECTOR_MISSING/);
  assert.match(gate, /publishRedactedExternalText/);
  assert.doesNotMatch(gate, /apkText\.includes\(ANDROID_PACKAGE\)/);
  assert.doesNotMatch(gate, /text\.includes\(ANDROID_PACKAGE\)/);
  assert.doesNotMatch(gate, /outcome:\s*["']SUCCESS["'].*maestroExecuted:\s*false/s);

  console.log(`OK: scaffold Maestro ${REQUIRED.length} YAML + contrat anti-faux-E2E (pas d'exécution APK)`);
}

main();
