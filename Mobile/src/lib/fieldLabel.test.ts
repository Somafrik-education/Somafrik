/**
 * Astérisque d'obligation — FieldLabel Mobile.
 *   npx tsx Mobile/src/lib/fieldLabel.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FORM_LABEL_COLOR, FORM_REQUIRED_MARK_COLOR, formatFieldLabel } from "./formFieldTokens";

const ROOT = path.join(__dirname, "..", "..", "..");
const fieldLabel = fs.readFileSync(path.join(ROOT, "Mobile/src/components/FieldLabel.tsx"), "utf8");
const formField = fs.readFileSync(path.join(ROOT, "Mobile/src/components/FormField.tsx"), "utf8");
const chips = fs.readFileSync(path.join(ROOT, "Mobile/src/components/ChoiceChips.tsx"), "utf8");
const adminCrud = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/AdminCrudScreen.tsx"), "utf8");
const assignments = fs.readFileSync(path.join(ROOT, "Mobile/src/components/AssignmentMutationControls.tsx"), "utf8");
const classes = fs.readFileSync(path.join(ROOT, "Mobile/src/components/ClassMutationControls.tsx"), "utf8");
const profile = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/EstablishmentProfileScreen.tsx"), "utf8");
const yearSettings = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/SchoolYearSettingsScreen.tsx"), "utf8");

assert.equal(formatFieldLabel("Nom", { required: true }), "Nom *");
assert.equal(formatFieldLabel("Ville", {}), "Ville");
assert.equal(FORM_REQUIRED_MARK_COLOR, "#DC2626");
assert.notEqual(FORM_REQUIRED_MARK_COLOR, FORM_LABEL_COLOR);

assert.match(fieldLabel, /testID="required-mark"/);
assert.match(fieldLabel, /FORM_REQUIRED_MARK_COLOR/);
assert.match(fieldLabel, /\{required \? \(/);
assert.match(fieldLabel, /optional && !required/);
assert.doesNotMatch(fieldLabel, /color: FORM_LABEL_COLOR[\s\S]*\*/);

assert.match(formField, /<FieldLabel label=\{label\} required=\{required\} optional=\{optional\} \/>/);
assert.match(formField, /formatFieldLabel\(label, \{ required, optional \}\)/);
assert.doesNotMatch(formField, /<Text style=\{styles\.label\}>\{visibleLabel\}<\/Text>/);

assert.match(chips, /<FieldLabel label=\{label\} required=\{required\} optional=\{optional\} \/>/);
assert.match(adminCrud, /<FieldLabel/);
assert.doesNotMatch(adminCrud, /formatFieldLabel/);

assert.match(assignments, /label="Enseignant" required/);
assert.match(assignments, /label="Classe" required/);
assert.match(assignments, /label="Cours" required/);
assert.match(classes, /label="Année scolaire"\s+required/);
assert.match(profile, /label="Téléphone"[\s\S]*required/);
assert.match(profile, /label="Courriel"[\s\S]*required/);
assert.match(profile, /label="Responsable légal"[\s\S]*required/);
assert.match(yearSettings, /label="Nouveau type" required/);
assert.doesNotMatch(yearSettings, /label="Barème par défaut"[^>]*required/);

assert.match(formField, /required\?: boolean/);
assert.match(formField, /accessibilityLabel=\{accessibilityLabel \?\? accessibleLabel\}/);

console.log("OK fieldLabel: * rouge isolé, facultatif sans astérisque, FormField/ChoiceChips/AdminCrud branchés");
