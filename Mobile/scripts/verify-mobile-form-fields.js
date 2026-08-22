/**
 * P1 — gouvernance des champs vides Mobile.
 * Tout TextInput métier doit passer par FormField (label + placeholderTextColor canonique).
 *
 * Usage : npm run verify:mobile-form-fields
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const MOBILE = path.join(__dirname, "..");
const REPO = path.join(MOBILE, "..");
const SRC = path.join(MOBILE, "src");

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function runUnitTests() {
  for (const file of ["formFieldValidation.test.ts", "paymentEnrollment.test.ts"]) {
    const result = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", file)], {
      cwd: MOBILE,
      encoding: "utf8",
      env: process.env,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `${file} a échoué`);
    }
    process.stdout.write(result.stdout || "");
  }
}

function main() {
  runUnitTests();

  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    if (rel === "components/FormField.tsx") continue;
    const source = fs.readFileSync(file, "utf8");
    if (/<TextInput\s/.test(source)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `TextInput métier hors FormField. Migrer vers le composant canonique :\n${offenders.join("\n")}`,
  );

  const formField = fs.readFileSync(path.join(SRC, "components", "FormField.tsx"), "utf8");
  assert.match(formField, /placeholderTextColor=\{FORM_PLACEHOLDER_COLOR\}/);
  assert.match(formField, /color: FORM_VALUE_COLOR/);
  assert.match(formField, /accessibilityLabel=\{accessibilityLabel \?\? visibleLabel\}/);
  assert.match(formField, /formatFieldLabel/);

  const tokens = fs.readFileSync(path.join(SRC, "lib", "formFieldTokens.ts"), "utf8");
  assert.match(tokens, /FORM_PLACEHOLDER_COLOR = "#94A3B8"/);
  assert.match(tokens, /FORM_VALUE_COLOR = "#0F172A"/);

  const student = fs.readFileSync(path.join(SRC, "components", "StudentMutationControls.tsx"), "utf8");
  assert.match(student, /from "\.\/FormField"/);
  assert.match(student, /resolvePreferredClassCode/);
  assert.doesNotMatch(student, /classOptions\[0\]/);
  assert.match(student, /placeholder="Ex\. Esther"/);
  assert.match(student, /placeholder="Ex\. Okito"/);
  assert.match(student, /placeholder="Ex\. \+243 8xx xxx xxx"/);
  assert.match(student, /Téléphone du parent/);
  assert.doesNotMatch(student, /Prénom et nom sont obligatoires/);

  const adminCrud = fs.readFileSync(path.join(SRC, "screens", "AdminCrudScreen.tsx"), "utf8");
  assert.doesNotMatch(
    adminCrud,
    /keyboardType=\{field\.keyboardType \?\? "default"\}/,
    "AdminCrud ne doit pas écraser le clavier canonique de FormField",
  );
  assert.match(adminCrud, /isRequiredAdminField\(entity, field\)/);
  assert.match(adminCrud, /styles\.selectInputInvalid/);
  assert.match(adminCrud, /fieldErrors\[field\.key\]/);

  const notifications = fs.readFileSync(path.join(SRC, "screens", "PlatformNotificationsScreen.tsx"), "utf8");
  assert.match(notifications, /await createPlatformNotification/);
  assert.match(notifications, /await loadNotifications\(\)/);
  assert.doesNotMatch(notifications, /upsertNotification\(/);

  const login = fs.readFileSync(path.join(SRC, "screens", "LoginScreen.tsx"), "utf8");
  assert.match(login, /passwordFieldErrors\.newPassword/);
  assert.match(login, /passwordFieldErrors\.confirmPassword/);

  const ciWorkflow = fs.readFileSync(path.join(REPO, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ciWorkflow, /npm run verify:mobile-form-fields/);
  const securityWorkflow = fs.readFileSync(path.join(REPO, ".github", "workflows", "security.yml"), "utf8");
  assert.ok(
    (securityWorkflow.match(/npm run verify:mobile-form-fields/g) ?? []).length >= 2,
    "Security doit exécuter verify:mobile-form-fields dans le job Security et la suite Tests",
  );

  console.log("OK: FormField canonique, erreurs par champ, notifications awaitées et garde-fou exécuté en CI/Security");
}

main();
