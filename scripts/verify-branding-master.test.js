"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SOMAFRIK_LOGO_MASTER,
  FORBIDDEN_SHA256,
  PLATFORM_DISPLAY_ASSETS,
  assertMasterAsset,
} = require("./verify-branding-master");

test("le pin master CTO est exact (SHA-256 + git blob + 1254×1254)", () => {
  assert.equal(SOMAFRIK_LOGO_MASTER.sha256, "7de03f1c81c52aebf2dfae1a0efbba1bb4b4c7786cb454d6cf3e96d2989b042c");
  assert.equal(SOMAFRIK_LOGO_MASTER.gitBlobSha, "4b8474e1efcc0ab30aa8c2d1c56cf3580252af72");
  assert.equal(SOMAFRIK_LOGO_MASTER.width, 1254);
  assert.equal(SOMAFRIK_LOGO_MASTER.height, 1254);
});

test("les surfaces PLATFORM affichées sont couvertes", () => {
  assert.ok(PLATFORM_DISPLAY_ASSETS.includes("web/public/somafrik-logo.png"));
  assert.ok(PLATFORM_DISPLAY_ASSETS.includes("Mobile/assets/somafrik-logo.png"));
  assert.ok(PLATFORM_DISPLAY_ASSETS.includes("Mobile/assets/somafrik-splash.png"));
});

test("les SHA BRANDING-V2 lockup/mark sont dans la liste interdite", () => {
  assert.ok(FORBIDDEN_SHA256.has("2d1593671c42dbfcca52c9cdfdb0a2e56d2cb4b69ae3c41ae913bd43abacb6df"));
  assert.ok(FORBIDDEN_SHA256.has("50b90266e93857db8f7bd04240893a51d77051d48e4d5ab5dec1b92c38d08b3b"));
});

test("assertMasterAsset refuse un PNG qui n'est pas le master", () => {
  assert.throws(
    () => assertMasterAsset("backend/assets/somafrik-logo.png"),
    (error) => /master CTO|BRANDING-V2 interdit|PNG invalide/.test(String(error.message || error)),
  );
});
