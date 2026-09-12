"use strict";

/**
 * Contrat source : aucun champ URL de logo côté établissement.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("Web profil établissement : pas de champ URL du logo", () => {
  const src = read("web/src/pages/parametres/EstablishmentProfilePage.tsx");
  assert.doesNotMatch(src, /Logo \(URL\)/);
  assert.doesNotMatch(src, /type="url"/);
  assert.doesNotMatch(src, /placeholder="https:/);
  assert.match(src, /Ajouter un logo|SchoolLogoUploadField/);
});

test("Web SchoolsPage : pas de saisie d'URL de logo", () => {
  const src = read("web/src/pages/SchoolsPage.tsx");
  assert.doesNotMatch(src, /Logo \(URL\)/);
  assert.doesNotMatch(src, /placeholder="https:\/\//);
});

test("Mobile profil établissement : pas de champ URL du logo", () => {
  const src = read("Mobile/src/screens/EstablishmentProfileScreen.tsx");
  assert.doesNotMatch(src, /Logo \(URL\)/);
  assert.doesNotMatch(src, /type="url"/);
  assert.match(src, /Ajouter un logo|launchImageLibraryAsync/);
});

test("Mobile AdminCrud écoles : pas de placeholder URL de logo", () => {
  const src = read("Mobile/src/screens/AdminCrudScreen.tsx");
  assert.doesNotMatch(src, /URL JPG, PNG ou WebP/);
  assert.doesNotMatch(src, /placeholder: "URL JPG/);
});

test("login / rôle : école sans logo ≠ fallback Somafrik", () => {
  const login = read("Mobile/src/screens/LoginScreen.tsx");
  const roles = read("Mobile/src/screens/RoleSelectionScreen.tsx");
  assert.match(login, /schoolLogoDisplayUri|schoolHasLogo/);
  assert.doesNotMatch(
    login,
    /school\?\.logoUrl \?[\s\S]{0,180}somafrikLogo/,
  );
  assert.doesNotMatch(
    roles,
    /school\.logoUrl \?[\s\S]{0,180}somafrikLogo/,
  );
});

test("PDF ne retombe plus sur backend/assets/somafrik-logo", () => {
  const renderer = read("backend/services/bulletinPdfRenderer.js");
  assert.doesNotMatch(renderer, /somafrik-logo\.jpg/);
  assert.doesNotMatch(renderer, /somafrik-logo\.png/);
  assert.match(renderer, /resolveSchoolLogoPath/);
});

test("PATCH établissements n'accepte plus logoUrl comme champ profil", () => {
  const service = read("backend/services/establishmentService.js");
  assert.doesNotMatch(
    service,
    /ESTABLISHMENT_PROFILE_PATCH_FIELDS[\s\S]{0,200}"logoUrl"/,
  );
  assert.match(service, /delete incoming.logoSource/);
});

test("logo SCHOOL exige logoSource=school_upload", () => {
  const lib = read("backend/lib/schoolLogo.js");
  const web = read("web/src/lib/schoolLogo.ts");
  const mobile = read("Mobile/src/lib/schoolLogo.ts");
  assert.match(lib, /SCHOOL_LOGO_SOURCE_UPLOAD = "school_upload"/);
  assert.match(lib, /isSchoolUploadProvenance/);
  assert.match(lib, /if \(!isSchoolUploadProvenance\(school\)\) return false;/);
  assert.match(web, /logoSource[\s\S]{0,80}!== SCHOOL_UPLOAD/);
  assert.match(mobile, /logoSource[\s\S]{0,80}!== SCHOOL_UPLOAD/);
});

test("gate branding-master pin le SHA-256 CTO", () => {
  const src = read("scripts/verify-branding-master.js");
  const pkg = read("package.json");
  assert.match(src, /7de03f1c81c52aebf2dfae1a0efbba1bb4b4c7786cb454d6cf3e96d2989b042c/);
  assert.match(src, /4b8474e1efcc0ab30aa8c2d1c56cf3580252af72/);
  assert.match(src, /web\/public\/somafrik-logo\.png/);
  assert.match(src, /Mobile\/assets\/somafrik-logo\.png/);
  assert.match(pkg, /verify:branding-master/);
});

test("routes logo : persist DB avant nettoyage fichier", () => {
  const server = read("backend/server.js");
  const lib = read("backend/lib/schoolLogo.js");
  assert.match(server, /commitSchoolLogoUpload/);
  assert.match(server, /commitSchoolLogoDelete/);
  assert.doesNotMatch(
    lib,
    /writeFile[\s\S]{0,200}previousKey[\s\S]{0,80}removeStoredLogo/,
  );
  assert.match(lib, /await persistEstablishment\(next\);[\s\S]{0,80}removeStoredLogo\(previousKey\)/);
  assert.match(lib, /removeStoredLogo\(saved\.storageKey\);[\s\S]{0,40}throw error/);
});
