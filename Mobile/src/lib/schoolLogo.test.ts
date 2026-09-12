/**
 * Contrat logo établissement Mobile : fichier local, jamais d'URL saisie, jamais de fallback Somafrik.
 *   npx tsx Mobile/src/lib/schoolLogo.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { schoolHasLogo, schoolLogoDisplayUri } from "./schoolLogo";

assert.equal(schoolHasLogo({ logoUrl: "https://cdn.evil.test/logo.png", code: "CD-IN-26-001" }), false);
assert.equal(schoolLogoDisplayUri({ logoUrl: "https://cdn.evil.test/logo.png", code: "CD-IN-26-001" }, "http://localhost:5000/api"), null);
assert.equal(schoolHasLogo({ hasLogo: true, loginCode: "CD-IN-26-001" }), true);
assert.equal(
  schoolLogoDisplayUri({ hasLogo: true, loginCode: "CD-IN-26-001" }, "http://localhost:5000/api"),
  "http://localhost:5000/api/schools/CD-IN-26-001/logo",
);
assert.equal(schoolHasLogo({ code: "CD-IN-26-001" }), false);

const ROOT = path.join(__dirname, "..", "..", "..");
const login = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/LoginScreen.tsx"), "utf8");
const roles = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/RoleSelectionScreen.tsx"), "utf8");
const profile = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/EstablishmentProfileScreen.tsx"), "utf8");
const crud = fs.readFileSync(path.join(ROOT, "Mobile/src/screens/AdminCrudScreen.tsx"), "utf8");

assert.match(login, /schoolLogoDisplayUri/);
assert.doesNotMatch(login, /school\?\.logoUrl \?[\s\S]{0,220}somafrikLogo/);
assert.match(roles, /schoolLogoDisplayUri/);
assert.doesNotMatch(roles, /school\.logoUrl \?[\s\S]{0,220}somafrikLogo/);
assert.doesNotMatch(profile, /Logo \(URL\)/);
assert.doesNotMatch(profile, /type="url"/);
assert.match(profile, /launchImageLibraryAsync/);
assert.match(profile, /Ajouter un logo/);
assert.doesNotMatch(crud, /URL JPG, PNG ou WebP/);

console.log("OK schoolLogo: pas d'URL saisie, pas de fallback Somafrik sur les surfaces établissement");
