"use strict";

/**
 * Gate CTO — le seul logo Somafrik PLATFORM autorisé est le master joint :
 * 1254×1254, SHA-256 7de03f1c…, git blob 4b8474e1…
 *
 * Aucune variante, reconstruction, recadrage ou ancien BRANDING-V2.
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const SOMAFRIK_LOGO_MASTER = Object.freeze({
  fileName: "Logo Somafrik final(1).png",
  sha256: "7de03f1c81c52aebf2dfae1a0efbba1bb4b4c7786cb454d6cf3e96d2989b042c",
  gitBlobSha: "4b8474e1efcc0ab30aa8c2d1c56cf3580252af72",
  width: 1254,
  height: 1254,
});

/** Anciens lockup/mark BRANDING-V2 — interdits sur les surfaces PLATFORM affichées. */
const FORBIDDEN_SHA256 = Object.freeze(
  new Set([
    "2d1593671c42dbfcca52c9cdfdb0a2e56d2cb4b69ae3c41ae913bd43abacb6df",
    "50b90266e93857db8f7bd04240893a51d77051d48e4d5ab5dec1b92c38d08b3b",
  ]),
);

const PLATFORM_DISPLAY_ASSETS = Object.freeze([
  "web/public/somafrik-logo.png",
  "Mobile/assets/somafrik-logo.png",
  "Mobile/assets/somafrik-splash.png",
]);

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(header).update(buffer).digest("hex");
}

function sha256Of(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(
    Buffer.isBuffer(buffer) && buffer.length >= 24 && buffer.subarray(0, 8).equals(signature),
    "PNG invalide",
  );
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function assertMasterAsset(relPath) {
  const abs = path.join(ROOT, relPath);
  assert.ok(fs.existsSync(abs), `asset PLATFORM manquant: ${relPath}`);
  const buffer = fs.readFileSync(abs);
  const digest = sha256Of(buffer);
  const blob = gitBlobSha(buffer);
  assert.ok(
    !FORBIDDEN_SHA256.has(digest),
    `${relPath}: ancien logo BRANDING-V2 interdit (${digest})`,
  );
  assert.equal(
    digest,
    SOMAFRIK_LOGO_MASTER.sha256,
    `${relPath}: SHA-256 n'est pas le master CTO (${digest})`,
  );
  assert.equal(
    blob,
    SOMAFRIK_LOGO_MASTER.gitBlobSha,
    `${relPath}: git blob n'est pas le master CTO (${blob})`,
  );
  const { width, height } = pngSize(buffer);
  assert.equal(width, SOMAFRIK_LOGO_MASTER.width, `${relPath}: largeur ${width} ≠ 1254`);
  assert.equal(height, SOMAFRIK_LOGO_MASTER.height, `${relPath}: hauteur ${height} ≠ 1254`);
  return buffer;
}

function verifyBrandingMaster() {
  for (const relPath of PLATFORM_DISPLAY_ASSETS) {
    assertMasterAsset(relPath);
  }
  console.log("OK verify:branding-master — assets PLATFORM = master CTO SHA-256 7de03f1c…");
}

module.exports = {
  SOMAFRIK_LOGO_MASTER,
  FORBIDDEN_SHA256,
  PLATFORM_DISPLAY_ASSETS,
  gitBlobSha,
  sha256Of,
  pngSize,
  assertMasterAsset,
  verifyBrandingMaster,
};

if (require.main === module) {
  try {
    verifyBrandingMaster();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
