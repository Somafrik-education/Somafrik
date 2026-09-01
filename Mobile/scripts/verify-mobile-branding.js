/**
 * BRANDING-V2 — garde-fou fail-closed sur les assets officiels Somafrik Mobile.
 *
 * Les assets racine sont la source canonique :
 * - logo without text.png -> marque UI (écrans) + source des icônes launcher
 * - logo with text.png    -> splash natif
 *
 * Les icônes launcher sont des variantes dédiées : même marque, logo réduit et
 * centré pour rester entier sous les masques iOS / Android adaptive.
 * Toute modification de marque doit rester volontaire : remplacer les assets
 * racine, régénérer les icônes, mettre à jour les SHA ci-dessous.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

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

const LAUNCHER = {
  iosIcon: {
    path: path.join(MOBILE, "assets", "somafrik-app-icon.png"),
    gitBlobSha: "956e583e40246e109dc2a0838f5e8a1fddbc4c94",
    appJsonPath: "./assets/somafrik-app-icon.png",
  },
  androidForeground: {
    path: path.join(MOBILE, "assets", "somafrik-android-adaptive-foreground.png"),
    gitBlobSha: "d7d79d5e2ca99d190686ef5d84ec73819446cb34",
    appJsonPath: "./assets/somafrik-android-adaptive-foreground.png",
  },
};

const ANDROID_SAFE_ZONE_RATIO = 66 / 108;
const WHITE_THRESHOLD = 248;

const LEGACY_MOBILE_ASSET_SHAS = new Set([
  "053d653257496a167b7c03981c21093544894af0",
  "526c8ee43a4d8a176bc96026dee8112715a20efc",
]);

const MOBILE_ASSETS = {
  icon: LAUNCHER.iosIcon.path,
  androidForeground: LAUNCHER.androidForeground.path,
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
  assert.equal(width, height, `${label}: l'icône launcher doit être carrée`);
  return { width, height };
}

function decodePng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(buffer.subarray(0, 8).equals(signature), "PNG signature invalide");
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert.equal(bitDepth, 8, "PNG bit depth 8 requis");
  assert.equal(interlace, 0, "PNG interlaced non supporté");
  const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  assert.ok(bpp > 0, `PNG color type non supporté: ${colorType}`);
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows = [];
  let cursor = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[cursor];
    cursor += 1;
    const raw = inflated.subarray(cursor, cursor + stride);
    cursor += stride;
    const recon = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? recon[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let value = raw[x];
      if (filter === 1) value = (value + left) & 255;
      else if (filter === 2) value = (value + up) & 255;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        value = (value + pr) & 255;
      } else {
        assert.equal(filter, 0, `filtre PNG non supporté: ${filter}`);
      }
      recon[x] = value;
    }
    rows.push(recon);
    prev = recon;
  }
  return { width, height, bpp, rows };
}

function contentMetrics(buffer) {
  const decoded = decodePng(buffer);
  const { width, height, bpp, rows } = decoded;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      const offset = x * bpp;
      const r = row[offset];
      const g = row[offset + 1];
      const b = row[offset + 2];
      const a = bpp === 4 ? row[offset + 3] : 255;
      if (a < 12) continue;
      if (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  assert.ok(maxX >= 0, "icône launcher sans contenu visible");
  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const boundingCircle = Math.hypot(boxW, boxH) / width;
  return {
    width,
    height,
    boxW,
    boxH,
    widthRatio: boxW / width,
    heightRatio: boxH / height,
    centerOffsetX: (centerX - width / 2) / width,
    centerOffsetY: (centerY - height / 2) / height,
    boundingCircle,
  };
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

function assertLauncherAsset(label, filePath, expectedSha) {
  const buffer = readBinary(filePath);
  const actualSha = gitBlobSha(buffer);
  assert.ok(
    !LEGACY_MOBILE_ASSET_SHAS.has(actualSha),
    `${label}: ancien asset Somafrik interdit (${actualSha})`,
  );
  assert.notEqual(
    actualSha,
    CANONICAL.mark.gitBlobSha,
    `${label}: doit être une variante dézoomée, pas le mark plein cadre`,
  );
  assert.equal(actualSha, expectedSha, `${label}: SHA launcher inattendu (${actualSha})`);
  assertPng(label, buffer);
  return { buffer, metrics: contentMetrics(buffer) };
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

  const ios = assertLauncherAsset("icône iOS / Expo", LAUNCHER.iosIcon.path, LAUNCHER.iosIcon.gitBlobSha);
  const android = assertLauncherAsset(
    "icône Android adaptive foreground",
    LAUNCHER.androidForeground.path,
    LAUNCHER.androidForeground.gitBlobSha,
  );
  assert.ok(
    ios.metrics.widthRatio >= 0.68 && ios.metrics.widthRatio <= 0.72,
    `icône iOS: largeur du logo hors cible 70% (${(ios.metrics.widthRatio * 100).toFixed(2)}%)`,
  );
  assert.ok(
    Math.abs(ios.metrics.centerOffsetX) < 0.01 && Math.abs(ios.metrics.centerOffsetY) < 0.01,
    "icône iOS: logo non centré",
  );
  assert.ok(
    android.metrics.boundingCircle <= ANDROID_SAFE_ZONE_RATIO + 0.002,
    `Android adaptive: bounding circle ${(android.metrics.boundingCircle * 100).toFixed(2)}% hors zone de sécurité 61.11%`,
  );
  assert.ok(
    Math.abs(android.metrics.centerOffsetX) < 0.01 && Math.abs(android.metrics.centerOffsetY) < 0.01,
    "Android adaptive: logo non centré",
  );
  assert.ok(
    android.metrics.boundingCircle < ios.metrics.boundingCircle,
    "Android adaptive doit être plus dézoomé que l'icône iOS",
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
  assert.equal(appJson.expo.icon, LAUNCHER.iosIcon.appJsonPath);
  assert.equal(appJson.expo.splash?.image, "./assets/somafrik-splash.png");
  assert.equal(
    appJson.expo.android?.adaptiveIcon?.foregroundImage,
    LAUNCHER.androidForeground.appJsonPath,
  );
  assert.notEqual(
    appJson.expo.icon,
    appJson.expo.android?.adaptiveIcon?.foregroundImage,
    "iOS et Android adaptive doivent pointer vers des variantes distinctes",
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
  assert.doesNotMatch(
    appConfig,
    /adaptiveIcon/,
    "app.config.js ne doit pas écraser adaptiveIcon de app.json",
  );

  console.log(
    "OK: BRANDING-V2 — marque UI/splash canoniques ; icônes launcher dézoomées iOS + Android adaptive",
  );
}

module.exports = {
  CANONICAL,
  LAUNCHER,
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
