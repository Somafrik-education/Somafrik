/**
 * BRANDING-V2 — garde-fou fail-closed sur les assets officiels Somafrik Mobile.
 *
 * Les assets racine sont la source canonique :
 * - logo without text.png -> icône Android + marque UI
 * - logo with text.png    -> splash natif
 *
 * Toute modification de marque doit être volontaire : remplacer les assets racine,
 * mettre à jour les SHA Git canoniques ci-dessous et faire revalider le diff GitHub.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const MOBILE = path.join(ROOT, "Mobile");

const CANONICAL = {
  mark: {
    path: path.join(ROOT, "logo without text.png"),
    gitBlobSha: "fd536bebf1a7f8f12605fc140180402a8d490a83",
  },
  lockup: {
    path: path.join(ROOT, "logo with text.png"),
    gitBlobSha: "0ac5e3ff2c36eb80e1fc3157aa41a5a506d5e0eb",
  },
};

const LEGACY_MOBILE_ASSET_SHAS = new Set([
  "053d653257496a167b7c03981c21093544894af0",
  "526c8ee43a4d8a176bc96026dee8112715a20efc",
]);

const MOBILE_ASSETS = {
  icon: path.join(MOBILE, "assets", "somafrik-app-icon.png"),
  uiLogo: path.join(MOBILE, "assets", "somafrik-logo.png"),
  splash: path.join(MOBILE, "assets", "somafrik-splash.png"),
};

function readBinary(filePath) {
  assert.ok(fs.existsSync(filePath), `Branding manquant: ${path.relative(ROOT, filePath)}`);
  return fs.readFileSync(filePath);
}

function readText(filePath) {
  assert.ok(fs.existsSync(filePath), `Fichier manquant: ${path.relative(ROOT, filePath)}`);
  return fs.readFileSync(filePath, "utf8");
}

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(buffer).digest("hex");
}

function assertPng(label, buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(
    buffer.length >= 24 && buffer.subarray(0, 8).equals(signature),
    `${label}: asset PNG invalide`,
  );
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert.ok(width >= 1024 && height >= 1024, `${label}: résolution insuffisante (${width}x${height})`);
  return { width, height };
}

function assertCanonicalAsset(label, filePath, expectedSha) {
  const buffer = readBinary(filePath);
  const actualSha = gitBlobSha(buffer);
  assert.equal(
    actualSha,
    expectedSha,
    `${label}: source canonique modifiée sans validation BRANDING-V2 (${actualSha})`,
  );
  assertPng(label, buffer);
  return buffer;
}

function assertMobileAsset(label, filePath, canonicalBuffer, expectedSha) {
  const buffer = readBinary(filePath);
  const actualSha = gitBlobSha(buffer);
  assert.ok(
    !LEGACY_MOBILE_ASSET_SHAS.has(actualSha),
    `${label}: ancien asset Somafrik interdit (${actualSha})`,
  );
  assert.equal(actualSha, expectedSha, `${label}: SHA non canonique (${actualSha})`);
  assert.ok(buffer.equals(canonicalBuffer), `${label}: contenu différent de la source canonique`);
  assertPng(label, buffer);
}

function verifyMobileBranding() {
  const canonicalMark = assertCanonicalAsset(
    "logo sans texte racine",
    CANONICAL.mark.path,
    CANONICAL.mark.gitBlobSha,
  );
  const canonicalLockup = assertCanonicalAsset(
    "logo avec texte racine",
    CANONICAL.lockup.path,
    CANONICAL.lockup.gitBlobSha,
  );

  assertMobileAsset(
    "icône Android",
    MOBILE_ASSETS.icon,
    canonicalMark,
    CANONICAL.mark.gitBlobSha,
  );
  assertMobileAsset(
    "logo UI",
    MOBILE_ASSETS.uiLogo,
    canonicalMark,
    CANONICAL.mark.gitBlobSha,
  );
  assertMobileAsset(
    "splash natif",
    MOBILE_ASSETS.splash,
    canonicalLockup,
    CANONICAL.lockup.gitBlobSha,
  );

  const appJson = JSON.parse(readText(path.join(MOBILE, "app.json")).replace(/^\uFEFF/, ""));
  assert.equal(appJson.expo.icon, "./assets/somafrik-app-icon.png");
  assert.equal(appJson.expo.splash?.image, "./assets/somafrik-splash.png");
  assert.equal(
    appJson.expo.android?.adaptiveIcon?.foregroundImage,
    "./assets/somafrik-app-icon.png",
  );

  for (const screen of ["WelcomeScreen.tsx", "RoleSelectionScreen.tsx", "LoginScreen.tsx"]) {
    const source = readText(path.join(MOBILE, "src", "screens", screen));
    assert.ok(
      source.includes('require("../../assets/somafrik-logo.png")'),
      `${screen}: doit utiliser le logo UI canonique`,
    );
  }

  const appConfig = readText(path.join(MOBILE, "app.config.js"));
  assert.match(appConfig, /\.\.\.config,/);
  assert.doesNotMatch(
    appConfig,
    /^\s*(?:icon|splash)\s*:/m,
    "app.config.js ne doit pas écraser icon/splash de app.json",
  );

  console.log(
    "OK: BRANDING-V2 — icône, logo UI et splash correspondent aux assets Somafrik canoniques",
  );
}

module.exports = {
  CANONICAL,
  LEGACY_MOBILE_ASSET_SHAS,
  MOBILE_ASSETS,
  gitBlobSha,
  verifyMobileBranding,
};

if (require.main === module) {
  try {
    verifyMobileBranding();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
