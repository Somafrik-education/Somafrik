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
  const result = spawnSync("npx", ["--yes", "tsx", path.join("src", "lib", "formFieldValidation.test.ts")], {
    cwd: MOBILE,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "formFieldValidation.test.ts a échoué");
  }
  process.stdout.write(result.stdout || "");
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

  console.log("OK: FormField canonique, labels permanents, placeholder non thématique, pas de fallback 1re classe");
}

main();
