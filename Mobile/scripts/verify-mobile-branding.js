/**
 * BRANDING-V2 — garde-fou fail-closed sur les assets officiels Somafrik Mobile.
 *
 * Les assets racine sont la source canonique :
 * - logo without text.png -> icône Android + marque UI
 * - logo with text.png    -> splash natif
 *
 * Conservés hors chrome Web/Mobile (historiques, non servis comme favicon/splash) :
 * - backend/assets/schoollink-logo.png|.jpg
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

/** Visuel circulaire famille/école (favicon + apple-touch legacy). */
const LEGACY_WEB_ICON_SHAS = new Set([
  "65f42746de312fc856ec84b0323e0da460f1071f",
  "19c66e20947d845bc12fef24695002eb5fbf5f06",
]);

const MOBILE_ASSETS = {
  icon: path.join(MOBILE, "assets", "somafrik-app-icon.png"),
  uiLogo: path.join(MOBILE, "assets", "somafrik-logo.png"),
  splash: path.join(MOBILE, "assets", "somafrik-splash.png"),
};

const WEB_ASSETS = {
  mark: path.join(ROOT, "web", "public", "somafrik-icon.png"),
  lockup: path.join(ROOT, "web", "public", "somafrik-logo.png"),
  faviconPng: path.join(ROOT, "web", "public", "favicon.png"),
  favicon32: path.join(ROOT, "web", "public", "favicon-32.png"),
  faviconIco: path.join(ROOT, "web", "public", "favicon.ico"),
  manifest: path.join(ROOT, "web", "public", "site.webmanifest"),
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

function assertPngSize(label, buffer, minWidth, minHeight = minWidth) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(
    buffer.length >= 24 && buffer.subarray(0, 8).equals(signature),
    `${label}: asset PNG invalide`,
  );
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert.ok(
    width >= minWidth && height >= minHeight,
    `${label}: résolution insuffisante (${width}x${height})`,
  );
  return { width, height };
}

function assertPng(label, buffer) {
  return assertPngSize(label, buffer, 1024);
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
  assert.equal(appJson.expo.web?.favicon, "./assets/somafrik-app-icon.png");

  const indexHtml = readText(path.join(ROOT, "web", "index.html"));
  assert.match(indexHtml, /%BASE_URL%favicon\.ico/);
  assert.match(indexHtml, /%BASE_URL%favicon-32\.png/);
  assert.match(indexHtml, /%BASE_URL%favicon\.png/);
  assert.match(indexHtml, /%BASE_URL%somafrik-icon\.png/);
  assert.match(indexHtml, /%BASE_URL%site\.webmanifest/);
  assert.doesNotMatch(indexHtml, /href="somafrik-icon\.png"/);

  assertMobileAsset("icône web / apple-touch", WEB_ASSETS.mark, canonicalMark, CANONICAL.mark.gitBlobSha);
  assertMobileAsset("logo web", WEB_ASSETS.lockup, canonicalLockup, CANONICAL.lockup.gitBlobSha);

  const faviconPng = readBinary(WEB_ASSETS.faviconPng);
  assert.ok(!LEGACY_WEB_ICON_SHAS.has(gitBlobSha(faviconPng)), "favicon.png legacy interdit");
  assertPngSize("favicon.png", faviconPng, 192, 192);

  const favicon32 = readBinary(WEB_ASSETS.favicon32);
  assert.ok(!LEGACY_WEB_ICON_SHAS.has(gitBlobSha(favicon32)), "favicon-32.png legacy interdit");
  assertPngSize("favicon-32.png", favicon32, 32, 32);

  const faviconIco = readBinary(WEB_ASSETS.faviconIco);
  assert.equal(faviconIco.readUInt16LE(0), 0);
  assert.equal(faviconIco.readUInt16LE(2), 1, "favicon.ico doit être un ICO");
  assert.ok(faviconIco.readUInt16LE(4) >= 1, "favicon.ico sans image");

  const manifest = JSON.parse(readText(WEB_ASSETS.manifest).replace(/^\uFEFF/, ""));
  assert.equal(manifest.name, "Somafrik");
  assert.ok(manifest.icons?.some((icon) => icon.src === "somafrik-icon.png"));

  console.log(
    "OK: BRANDING-V2 — icône, logo UI, splash et favicon web correspondent aux assets Somafrik canoniques",
  );
}

module.exports = {
  CANONICAL,
  LEGACY_MOBILE_ASSET_SHAS,
  LEGACY_WEB_ICON_SHAS,
  MOBILE_ASSETS,
  WEB_ASSETS,
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
